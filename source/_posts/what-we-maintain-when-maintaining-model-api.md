---
title: "当我们在维护模型 API 服务时我们在维护什么"
type: tags
date: 2026-03-15 22:00:00
tags: [编程,Python,FastAPI,AI,Infra,笔记]
categories: [编程,AI]
toc: true
swiper_index: 0
---

过去这一年我们团队陆陆续续做了几个 AI Service——大多是拿 FastAPI 包一个模型，再对外出 API。做到第三四个的时候我意识到一个尴尬的事实：每个项目长得都差不多，但每次起新项目还是在从零开始复制粘贴，而且不同的人写出来的目录结构、配置方式、metrics 命名都不太一样。一个新人接手第二个服务的时候，几乎要把第一个服务的认知全部重学一遍。

这篇文章想聊的不是某个具体框架，而是把这几个项目踩过的坑、迭代下来的设计、留下来的规范集中讲一遍——也算是给"维护一个模型 API 服务"这件事做一次复盘。

<!--more-->

## 正文

把"维护一个模型 API 服务"拆开看，其实是几个相互独立但又互相影响的小问题：项目长什么样、配置怎么分层、模型版本怎么迭代、可观测性怎么做、日常开发流程怎么走、CI 和镜像怎么发。下面按这几个维度逐个聊。

### 一个 AI Service 该长什么样

先看目录结构。我们最终收敛到的样子是：

```text
src/<service_name>/
├── __init__.py          # __version__ + beartype_this_package()
├── app.py               # create_app() factory, registries, lifespan, health mount
├── cli.py               # typer CLI: serve with --api-version list
├── config.py            # pydantic-settings BaseSettings + @cache singleton
├── handler.py           # BaseHandler ABC + shared request/response schemas
├── metrics.py           # Prometheus MetricsRegistry (version-aware)
├── v1/
│   ├── handler.py       # V1 Handler + get_handler
│   └── router.py        # register_router(app) with v1 routes
└── v2/                  # added when model evolves
    ├── handler.py       # V2 Handler + get_handler
    └── router.py        # register_router(app) with v2 routes
test/
├── test_app.py          # API integration tests
pyproject.toml           # hatchling build backend, uv managed
Makefile                 # install, format, lint, test, dev, clean
Dockerfile               # multi-stage with uv
entrypoint.sh            # calls CLI serve command
```

跟我们最早的版本比，最大的变化是引入了**版本子目录**。顶层的 `handler.py` 退化成了抽象基类，每个版本（v1、v2……）有自己的 handler 和 router。这是某个项目从 v1 演进到 v2 的时候被迫定型下来的——你不可能在原地修改老接口，又要让两个模型同时在线，唯一可行的就是物理隔离。

下面挑几个真正影响维护体验的点展开聊。

#### beartype：把类型检查塞进运行时

每个包的 `__init__.py` 第一行：

```python
from beartype.claw import beartype_this_package
beartype_this_package()

__version__ = "0.1.0"
```

`beartype_this_package()` 会给整个包的所有函数挂上运行时类型检查，开销接近零。它能抓住静态检查器搞不定的那一类 bug——你函数签名写的是 `str`，但运行时传进来一个 `None`；或者 tensor shape 不对；或者某个第三方库返回值的类型和文档不一致。

在 AI Service 这种场景里，模型推理链路上的类型错误特别常见——预处理、tokenize、forward、后处理，每一步都可能有数据形状或类型上的微妙差异。能在 import 时就把网撒开，越早暴露越好。

#### 配置分三层：Secret / App / CLI

这是看起来朴素但实战非常关键的一个设计——我们把配置严格分成三类：

- **Secret**：HF token、API key、数据库密码——只从环境变量或 Vault 读，永远不进 YAML，不进 git
- **App config**：model id、torch.compile 开关、各种业务阈值——主要从 YAML 读，环境变量可以覆盖
- **运行时参数**：host、port、启用哪些版本——走 CLI

代码层面 Secret 和 App 是两个独立的 pydantic-settings 类：

```python
class SecretSettings(BaseSettings):
    """Secrets only — always from env vars or Vault. Never put these in YAML."""
    model_config = SettingsConfigDict(env_prefix="<APP>_")
    hf_token: str | None = None

class AppSettings(BaseSettings):
    """General service config — from YAML, overridable by env vars."""
    model_config = SettingsConfigDict(
        yaml_file="config.yaml",
        env_prefix="<APP>_",
    )
    model_id: str = "default-model-name"
    torch_compile: bool = True

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        return (
            init_settings,
            env_settings,
            YamlConfigSettingsSource(settings_cls),
            file_secret_settings,
        )
```

这种分层一开始看起来啰嗦，但维护几个项目下来你会发现：每次出"配置爆炸"问题、每次部署混乱，几乎都来自把这三类东西混在一起处理。强制分层之后，K8s 的 Secret、ConfigMap、Deployment args 各管各的，review 起来一目了然。

#### Registry-Based App Factory：让 app.py 永远不用动

整个项目最值得说的一个设计决策——用注册表 + 动态导入来管理多版本，让 `app.py` 在加新版本时一行不用改。

`app.py` 里有两个 registry dict：

```python
ROUTER_REGISTRY: dict[str, str] = {
    "v1": "<service_name>.v1.router",
    "v2": "<service_name>.v2.router",
}

# (handler module, handler class, app.state attr, settings model_id attr)
HANDLER_REGISTRY: dict[str, tuple[str, str, str, str]] = {
    "v1": ("<service_name>.v1.handler", "Handler", "handler", "v1_model_id"),
    "v2": ("<service_name>.v2.handler", "Handler", "v2_handler", "v2_model_id"),
}
```

`create_app` 接受一个版本列表，支持同时跑多个版本：

```python
def create_app(api_versions: list[str] | None = None) -> FastAPI:
    if api_versions is None:
        api_versions = ["v1"]

    app = FastAPI(title="<Service Name>", version=__version__, lifespan=lifespan)
    app.state.api_versions = api_versions
    mount_health_routes(app)

    for version in api_versions:
        module = importlib.import_module(ROUTER_REGISTRY[version])
        module.register_router(app)

    return app
```

`lifespan` 遍历版本列表，动态加载每个版本的 Handler，存到不同的 `app.state` 属性上：

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    for version in app.state.api_versions:
        module_path, class_name, attr_name, model_id_attr = HANDLER_REGISTRY[version]
        model_id = getattr(settings, model_id_attr)
        module = importlib.import_module(module_path)
        handler_cls = getattr(module, class_name)
        handler = await asyncio.to_thread(handler_cls, model_id, settings.hf_token)
        setattr(app.state, attr_name, handler)
    yield
```

这个设计的好处是：`app.py` 不需要 import 任何具体版本的模块，加新版本就是加文件 + 加 registry 条目。换句话说，**核心入口对版本扩展是封闭的，对版本添加是开放的**——OCP 在这种场景下特别好用。

#### Handler 和 Router 的分版本组织

顶层 `handler.py` 定义 `BaseHandler` ABC 和共享的 schema：

```python
class BaseHandler(ABC):
    @abstractmethod
    def _load_tokenizer_and_model(self, model_id: str, hf_token: str) -> tuple: ...

    def predict(self, request: BasePredictRequest) -> list[PredictResponse]:
        # 共享的推理逻辑
        ...
```

每个版本的 `handler.py` 实现具体的模型加载，并提供一个 `get_handler` 读取自己那个 `app.state` 属性：

```python
# v1/handler.py
def get_handler(request: Request) -> Handler:
    return request.app.state.handler       # v1

# v2/handler.py
def get_handler(request: Request) -> Handler:
    return request.app.state.v2_handler    # v2
```

每个版本的 `router.py` 用 `register_router(app)` 闭包模式定义路由：

```python
# v1/router.py — v1 没有前缀（默认版本）
def register_router(app: FastAPI) -> None:
    router = APIRouter()
    @router.post("/predict")
    async def predict(...) -> list[PredictResponse]:
        ...
    app.include_router(router)

# v2/router.py — v2 带版本前缀
def register_router(app: FastAPI) -> None:
    router = APIRouter(prefix="/v2")
    @router.post("/predict")
    async def predict(...) -> list[PredictResponse]:
        ...
    app.include_router(router)
```

注意 v1 的路由没有前缀（路径就是 `/predict`），v2 才开始加 `/v2` 前缀。这是对历史的一种妥协——v1 是最早的版本，改路径会破坏已有消费者，所以新增版本的代价由新版本自己承担。

所有 CPU 密集的推理操作都用 `asyncio.to_thread` 包起来。路由函数的返回值类型注解就是响应模型——不用 `response_model=` 参数，直接写 `-> list[PredictResponse]`，FastAPI 会自动推断。

### 模型版本怎么演进：一条铁律

讲完结构，最容易踩坑的部分是模型版本迭代。我们给自己立了一条铁律：

> **NEVER modify or rename an existing API route when adding a new model version.**

听起来是废话，但真做的时候很多人会犯错。以下这些操作我们都见过、踩过、或者在 review 时拦下来过：

- 把 `/api/v1/encode` 改名成 `/api/v1/encode-legacy`，让它"看起来像被废弃了"
- 修改已有接口的 request/response schema（哪怕只是加一个可选字段）
- 在已有的 request 里加一个 `model_version` 字段来复用同一个路由
- 直接替换已有路由背后的模型（行为变了但版本号没变——这是 bug，不是 feature）

正确的做法只有一种，不管 API shape 变不变，流程都一样：

1. 加 `v2/handler.py` + `v2/router.py`
2. 在 `app.py` 的 `ROUTER_REGISTRY` 和 `HANDLER_REGISTRY` 里加两行
3. 完事

```text
新模型来了？
├── 加 v2/ 子目录（handler + router）
├── 在 app.py 的两个 REGISTRY 里加条目
├── 通过 --api-version 控制启用哪些版本
│   ├── 只跑 v2: --api-version v2
│   └── 同时跑: --api-version v1 --api-version v2
└── 老模型要下线？
    ├── 先在老路由里加 deprecation log warning
    ├── 看版本隔离的 metrics 确认零流量
    └── 确认后删除 v1/ 目录和 registry 条目
```

CLI 的 `--api-version` 是一个 list 参数，天然支持多版本同时运行：

```python
@cli.command()
def serve(
    host: Annotated[str, typer.Option(help="Host to bind to")] = "0.0.0.0",
    port: Annotated[int, typer.Option(help="Port to bind to")] = 8000,
    api_version: Annotated[
        list[str], typer.Option("--api-version", help="API versions to enable")
    ] = ["v1"],
) -> None:
    app = create_app(api_versions=api_version)
    uvicorn.run(app, host=host, port=port)
```

如果新模型的 API shape 变了（比如 request 多了字段），v2 的 handler 里直接 subclass `BasePredictRequest` 加字段就行。v2 的 router 带 `/v2` 前缀，v1 的路由完全不受影响。

### 可观测性：版本感知的 metrics

模型迭代过程中真正让人头疼的不是"加版本"，而是"下版本"——你怎么确认 v1 真的没人用了，可以放心删？这就要求 metrics 必须按版本天然分开。

我们的做法是：每个 API 版本拥有自己的 `MetricsRegistry` 实例，通过 Prometheus 的 `subsystem` 命名来隔离。

```python
_METRIC_NAMESPACE = "<service_name>"

class MetricsRegistry(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)
    predict_time: Histogram
    result_count: Counter

_registries: dict[str, MetricsRegistry] = {}

def get_metrics_registry(version: str) -> MetricsRegistry:
    if version in _registries:
        return _registries[version]
    subsystem = "api" if version == "v1" else f"api_{version}"
    registry = MetricsRegistry(
        predict_time=Histogram(
            name="predict_time",
            documentation="Time taken to run a prediction",
            namespace=_METRIC_NAMESPACE,
            subsystem=subsystem,
            buckets=tuple(2**i * 1e-3 for i in range(13)),  # 1ms ~ 4s
        ),
        result_count=Counter(
            name="predict_result_total",
            documentation="Number of results",
            namespace=_METRIC_NAMESPACE,
            subsystem=subsystem,
            labelnames=["label"],
        ),
    )
    _registries[version] = registry
    return registry
```

v1 的指标叫 `<service_name>_api_predict_time`，v2 的叫 `<service_name>_api_v2_predict_time`。在 Grafana 里天然隔离，不需要额外加 label。

为什么不用 label 区分版本？因为 Histogram 的 `time()` context manager 不支持直接传 label，你得先 `.labels(version=...)` 再 `.time()`，每个调用点都要记得传，容易漏。而 subsystem 方案是在注册时就确定了，调用侧完全无感。

在每个版本的 `router.py` 的 `register_router` 里通过一个小 wrapper 注入：

```python
# v1/router.py
def _get_v1_metrics() -> MetricsRegistry:
    return get_metrics_registry("v1")

def register_router(app: FastAPI) -> None:
    router = APIRouter()

    @router.post("/predict")
    async def predict(
        request: PredictRequest,
        handler: Handler = Depends(get_handler),
        metrics_registry: MetricsRegistry = Depends(_get_v1_metrics),
    ) -> list[PredictResponse]:
        with metrics_registry.predict_time.time():
            results = await asyncio.to_thread(handler.predict, request)
            if results:
                metrics_registry.result_count.labels(label=results[0].label).inc()
        return results

    app.include_router(router)
```

除了自定义 metrics，还有一层全局的 HTTP 自动打点——用 `prometheus-fastapi-instrumentator`，它自带 handler label 可以按路径过滤，不需要按版本拆：

```python
def mount_health_routes(app: FastAPI) -> None:
    Instrumentator(
        should_instrument_requests_inprogress=True,
        inprogress_name="requests_in_progress",
        inprogress_labels=True,
    ).instrument(
        app,
        metric_namespace="<service_name>",
    ).expose(app)
    app.add_api_route("/health", health([]))
```

最终一个同时跑 v1 和 v2 的服务，`/metrics` 端点会输出：

| 指标名 | 类型 | 来源 |
| --- | --- | --- |
| `<service_name>_api_predict_time` | Histogram | v1 自定义 |
| `<service_name>_api_predict_result_total` | Counter | v1 自定义 |
| `<service_name>_api_v2_predict_time` | Histogram | v2 自定义 |
| `<service_name>_api_v2_predict_result_total` | Counter | v2 自定义 |
| `<service_name>_http_requests_total` | Counter | Instrumentator |
| `<service_name>_http_request_duration_seconds` | Histogram | Instrumentator |
| `<service_name>_requests_in_progress` | Gauge | Instrumentator |

自定义指标按版本隔离，HTTP 指标全局共享。下线 v1 的时候，看一眼 `rate(<service_name>_api_predict_time_count[5m])` 是不是零，决策成本几乎为零。

### 日常开发的规矩

几个项目下来攒出来的几条不成文规定，后来都被强制写进了项目模板。

#### 分支策略

一条规则，没有例外：

> **NEVER commit directly to main. All changes go through feature branches and PRs.**

分支命名：`feat/<topic>` 或 `fix/<topic>`，通过 `gh pr create` 或 GitHub Web UI 创建 PR，CI 过了再合。不管是新功能、bug fix 还是改个配置文件，都走这个流程。这条规则的意义不在 code review 本身，而是它强制了每一次变更都要走 CI——而 CI 是这套体系里所有约束的最终防线。

#### 提交前检查

每次 commit 前跑这三条：

```bash
uv run ruff check src/ scripts/ --fix
uv run ruff format src/ scripts/
uv run ty check
```

ruff 负责 lint 和格式化，ty（Astral 出的新一代 type checker）负责类型检查。这三条同时也会出现在 pre-commit hook 和 CI 里——本地、commit、CI 三道关口跑同一组命令，保证不会出现"本地通过 CI 挂"或者"CI 通过本地挂"的尴尬。

#### 测试实践

改了 `app.py`、`handler.py`、`config.py`、`metrics.py` 这些核心文件之后，必须跑测试：

```bash
uv run pytest test/ -v
```

测试用 `scope="session"` fixture 避免每个 test case 都重新加载模型（加载一个 transformer 模型可能要几十秒）：

```python
@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c
```

GPU 相关的测试通过环境变量控制，在 import 之前就设好：

```python
import os
os.environ["<APP>_TORCH_COMPILE"] = "false"  # 测试时跳过 torch.compile
```

每个 endpoint 至少要覆盖：happy path、默认参数、参数变体、422 校验、结果唯一性。

#### 发版流程

版本号维护在 `src/<service_name>/__init__.py` 里，hatchling 自动读取。整个发版流程被刻意做得很无聊：

1. 更新 `__version__`
2. 合并到 `main`
3. 在 GitHub 上创建 Release（不要手动打 tag）
4. GitHub Release 自动创建 tag，触发 `docker-release` CI 构建生产镜像

无聊就是稳定。人为干预越少，事故面就越小。

### 工具链与镜像

#### 工具链

我们的标准工具链：

- **包管理**：uv + `pyproject.toml` + `uv.lock`，构建后端用 hatchling
- **Lint**：ruff（check + format 一把梭）
- **类型检查**：ty
- **测试**：pytest
- **Pre-commit**：prek（pre-commit 的高性能替代）

`pyproject.toml` 里的工具配置：

```toml
[dependency-groups]
dev = [
    "pytest>=8.0.0",
    "ruff>=0.4.0",
    "ty>=0.0.19",
]

[tool.ruff]
line-length = 100

[tool.ruff.lint]
select = ["E", "F", "W", "A", "PLC", "PLE", "PLW", "I", "C"]

[tool.pytest.ini_options]
testpaths = ["test"]
```

每个项目有一个标准 Makefile（注意 Makefile 的缩进必须是 tab）：

```makefile
install:
    uv sync --frozen --no-install-project

format:
    uv run ruff format .
    uv run ruff check --fix .
    uv run ruff check --select I --fix .

lint:
    uv run ty check

test:
    uv run pytest

dev:
    $(MAKE) install
    uv run fastapi dev src/<service_name>/app.py
```

`make format && make lint && make test`，三板斧走完就可以提交。

#### Dockerfile

GPU 服务和 CPU 服务的 Dockerfile 不太一样，但有几个共同原则：

1. **两阶段依赖安装**：先 `uv sync --frozen --no-install-project`（只装依赖，利用 Docker 层缓存），再 `ADD . /app && uv sync --frozen`（装项目本身）
2. **挂载 uv 缓存**：`--mount=type=cache,target=/root/.cache/uv`
3. **构建时健全检查**：`python -c "import <service_name>; print(<service_name>.__version__)"`，在 build 阶段就发现 import 错误
4. **entrypoint 调 CLI**：不直接调 uvicorn，而是调 `entrypoint.sh` → CLI serve 命令——这样 host/port/api-version 这些运行时参数就不会散在 Dockerfile / k8s manifest / shell 多个地方

GPU 服务基于 `nvidia/cuda` 镜像：

```dockerfile
FROM nvidia/cuda:<version>-cudnn-runtime-ubuntu24.04 AS base

COPY --from=ghcr.io/astral-sh/uv:<uv-version> /uv /uvx /bin/

WORKDIR /app

# Stage 1: deps only
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-install-project

# Stage 2: project
ADD . /app
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen

EXPOSE 8000
CMD ["/app/entrypoint.sh"]

# Sanity check
RUN python -c "import <service_name>; print(<service_name>.__version__)"
```

CPU 服务用多阶段构建，运行时镜像不带 uv 和构建工具，还跑非 root 用户：

```dockerfile
# Build stage
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_NO_DEV=1

# ... install deps and project ...

# Runtime stage
FROM python:3.12-slim-bookworm

RUN groupadd --system --gid 999 nonroot \
    && useradd --system --gid 999 --uid 999 --create-home nonroot

COPY --from=builder --chown=nonroot:nonroot /app /app
USER nonroot

CMD ["/app/entrypoint.sh"]
```

#### GitHub Actions

三条流水线分工明确：

```yaml
# lint-and-test：push to main 和 PR 时触发
on:
  push:
    branches: [main]
  pull_request:

# docker-build：PR 时触发，验证 Docker 构建是否通过
on:
  pull_request:
    branches: ["main"]

# docker-release：v* tag 时触发，构建并推送生产镜像
on:
  push:
    tags: ["v*"]
```

PR push 触发构建验证，GitHub Release 创建 tag 触发生产镜像发布。整个链路自动化，人只需要点一下 Release 按钮。

## 怎么把这些经验落到下一个项目里

写到这其实想讲的核心都讲完了——那一串配置分层、registry 工厂、版本铁律、版本感知 metrics、CI/Docker 模板，每条背后都是某次具体的踩坑或者某次"诶我们上个服务好像也这样写过"的瞬间。

但写到第四第五个项目我们意识到：经验如果只活在某个人的脑子里，或者只在 wiki 上以"请参考某某规范"的形式存在，那它就只是一种"祝愿"——祝愿下一个起项目的同学读过、记得、并且在赶进度的时候还愿意按规矩来。这个祝愿命中率不高。

所以最近我们把这些经验沉淀成了一组 Claude Code Skill，按"项目脚手架 / 模型演进 / 日常维护 / CI 与镜像"四块拆开，写成了 AI 可以直接执行的指令。下次再起一个新的 AI Service，"帮我加一个 v2 的接口"这种话就直接对应到一组按规范操作的步骤——加新 router、加新 handler、加版本感知的 metrics、不碰已有接口。比起在 wiki 上写规范然后祈祷大家都读了，这种方式靠谱得多。

不过 skill 只是这套经验的一种载体——核心其实还是上面那些设计。哪怕你完全不用 Claude Code，把这些规则当成项目模板或者 cookiecutter 来用，也是一样的效果。

差不多就这样，希望对有类似需求的团队有点参考价值。
