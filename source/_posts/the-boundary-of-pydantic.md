---
title: "Pydantic 不是免费的——聊聊数据校验的边界"
type: tags
date: 2026-03-23 22:30:00
tags: [编程,Python,FastAPI,Pydantic,Perf,笔记]
categories: [编程,Python]
toc: true
swiper_index: 0
---

最近给一个推理后端服务做 perf，跑了一发 py-spy 出来火焰图，盯着看了一会儿，发现 `pydantic.main.__init__` 这一条在主热路径上占了一个让人挺难绷的比例。做了几轮调整之后顺手把这件事记一下——核心想说的是：**对一个 web 服务来说，数据校验从来不是免费的，pydantic 也一样。它有它的边界，越界使用就要付出对应的代价。**

<!--more-->

## 起因：火焰图里看到的东西

某个推荐链路服务，写法上挺标准——`FastAPI + uvicorn + pydantic + psycopg`，业务里所有"长得像数据"的东西，从 DB 行、内部传递的中间态、到 API response，全部都用 `BaseModel` 表达。看起来一致、规整，review 起来也舒服。

直到我们因为 P95 不太好看，跑了一发 py-spy：

```bash
py-spy record --duration 60 --rate 100 --output flame.svg --pid <uvicorn-worker-pid>
```

火焰图大约 8,700 个采样点，里面让我多看了一眼的是：

- `pydantic/main.py:250` 也就是 `BaseModel.__init__`，**单条最厚的火焰柱占了 22.65%**（约 1,982 samples）
- 顺着主链路再往上扒，另一条 `__init__` 路径又占了 6.81%
- 加加减减，光是"实例化 pydantic 模型"这一件事，在这个服务上吃掉了 **不止 25% 的 CPU 时间**

最骚的是，这些 `__init__` 大部分根本不是用户请求的入口校验，而是从我们自己的 PostgreSQL 里 `SELECT` 出来的行，被 `psycopg.rows.class_row(SomeModel)` 一行一行喂给 `BaseModel.__init__` 的——也就是说，我们在拿"自己写进去的、Schema 完全可控的数据"，反复跑一套带 schema validation 的实例化流程。

那一刻就一个念头：**这事真不值得。**

## 这件事意味着什么

Pydantic v2 已经把 validator 内核换成 Rust 写的 `pydantic-core` 了，比 v1 快了一个数量级。所以很多人下意识会觉得 "v2 的开销可以忽略"。这个印象大致没错——但只要你的 QPS 再高一点、单次请求里要构造的对象再多一点，"忽略不计的开销" × N 之后，它会非常明确地出现在你的 flame graph 上。

更重要的是，pydantic v2 快的是 **校验本身**。但你每实例化一次 `BaseModel`，整条链路是这样的：

```text
__init__ 入口
  ├── 查 schema cache
  ├── pydantic-core validator dispatch（rust 侧）
  │     ├── field-by-field 类型校验
  │     ├── model_validator(mode="before")
  │     ├── 默认值填充
  │     └── strict / coerce 分支
  ├── 写回 __dict__ / __pydantic_fields_set__
  └── model_validator(mode="after")
```

哪怕你的 model 没有任何 `validator`、没有任何 `Field(...)`，进 rust 转一圈再回来这件事本身就有不可压缩的成本——函数调用、字典构造、属性写入，每一项都要钱。

而把这套机制用在 **从可信源反序列化** 的场景上，大部分钱花得没意义——你这一行就是你刚才 `INSERT` 进去的，schema 对不上的概率约等于"你的 migration 没跑过"，那已经是另一类问题了。

## Pydantic 在一个 web 服务里到底干啥

把日常项目里 `BaseModel` 出现的地方分一下类，差不多是这五种：

1. **API 边界**：FastAPI route 的 request body / query / path param —— 输入来自外部，必须严格校验
2. **响应序列化**：FastAPI 的 response model —— 决定对外契约的 shape，并且要做 JSON 序列化
3. **应用配置**：`pydantic-settings` 读 YAML / env，启动时一次性校验
4. **业务规则校验**：带 `field_validator` / `model_validator` 的领域对象，比如 "金额必须是正数、组合字段必须满足某个不变式"
5. **内部数据容器**：DB 行映射、内部函数之间传递的中间态、纯粹为了"有类型、有字段名"而存在的小结构体

前四个有明确收益——schema 是契约，validation 就是这份契约的执行机制，它的运行时开销换的是 **类型/不变式上的安全保证**。

第五个，几乎全是白送的开销。这一类对象是在你自己写的代码里产生、在你自己写的代码里消费的，schema 已经被静态类型检查器（mypy / ty）和 beartype 之类工具覆盖到了；运行时再跑一次 pydantic 的校验，校验的对象要么是你 5 行前刚 query 出来的，要么是你 3 行前刚自己 `Item(...)` 构造的。换句话说，你是在校验你自己。

## 怎么替代：dataclass + slots

那第五类该用什么？答案非常无聊——标准库的 `@dataclass`，加 `slots=True`：

```python
from dataclasses import dataclass

@dataclass(slots=True)
class CandidateItem:
    id: str
    score: float
    rank: int
    bucket: str
```

`slots=True` 让实例不再有 `__dict__`，每次构造省一份哈希表分配，访问字段也直接走 C 层 slot。配合 beartype 的运行时类型检查（如果你像我们一样在 `__init__.py` 里 `beartype_this_package()`），整体的"类型安全度"和你用 pydantic 是同一个量级的，但开销低得多。

更顺的一点是：**`psycopg` 的 `class_row` 原生支持 dataclass**，几乎是无缝替换：

```python
from psycopg.rows import class_row

# 之前：BaseModel
class CandidateItem(BaseModel):
    id: str
    score: float
    rank: int
    bucket: str

# 之后：dataclass，调用方一行不用改
@dataclass(slots=True)
class CandidateItem:
    id: str
    score: float
    rank: int
    bucket: str

async def fetch_candidates(conn, n: int) -> list[CandidateItem]:
    async with conn.cursor(row_factory=class_row(CandidateItem)) as cur:
        await cur.execute(
            "SELECT id, score, rank, bucket FROM candidates ORDER BY rank LIMIT %s",
            (n,),
        )
        return await cur.fetchall()
```

调用侧的体感和原来一模一样——你照样有 `.id`、`.score`、`.rank`，照样能被 ty / mypy 检查类型，照样能 `for item in items: ...`。差别只是火焰图里那条粗柱子掉下去了。

## 一个完整的"边界感"示例

把上面的话翻成代码。假设我们要做一个 `/recommend` 接口，从 DB 取候选、做点轻量计算、然后返给调用方：

```python
from dataclasses import dataclass
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from psycopg.rows import class_row

# ---- API 边界：必须 pydantic ----

class RecommendRequest(BaseModel):
    """Request 来自外部，schema 必须严格校验。"""
    user_id: str = Field(min_length=1, max_length=64)
    limit: int = Field(default=20, ge=1, le=100)
    bucket: str | None = None

class RecommendItem(BaseModel):
    """Response 决定对外契约和 JSON 序列化方式。"""
    id: str
    score: float
    rank: int

class RecommendResponse(BaseModel):
    items: list[RecommendItem]
    total: int

# ---- 内部数据容器：dataclass 就够 ----

@dataclass(slots=True)
class CandidateRow:
    """从 DB 读出来的一行，schema 完全可控，不需要再校验一次。"""
    id: str
    score: float
    rank: int
    bucket: str
    raw_score: float

@dataclass(slots=True)
class ScoredCandidate:
    """中间计算态，只在内部函数之间传。"""
    id: str
    final_score: float
    rank: int

# ---- 业务实现 ----

async def fetch_candidates(conn, bucket: str | None, n: int) -> list[CandidateRow]:
    sql = "SELECT id, score, rank, bucket, raw_score FROM candidates"
    params: tuple = ()
    if bucket is not None:
        sql += " WHERE bucket = %s"
        params = (bucket,)
    sql += " ORDER BY rank LIMIT %s"
    params = (*params, n)

    async with conn.cursor(row_factory=class_row(CandidateRow)) as cur:
        await cur.execute(sql, params)
        return await cur.fetchall()

def rerank(rows: list[CandidateRow], user_id: str) -> list[ScoredCandidate]:
    # 纯内部计算，所有输入输出都来自我们自己
    return [
        ScoredCandidate(
            id=r.id,
            final_score=r.score * _user_factor(user_id, r.bucket),
            rank=i,
        )
        for i, r in enumerate(rows)
    ]

router = APIRouter()

@router.post("/recommend")
async def recommend(
    req: RecommendRequest,                    # pydantic 校验入参
    conn = Depends(get_conn),
) -> RecommendResponse:                       # pydantic 决定出参 shape
    rows = await fetch_candidates(conn, req.bucket, req.limit)   # dataclass
    scored = rerank(rows, req.user_id)                            # dataclass
    return RecommendResponse(
        items=[RecommendItem(id=s.id, score=s.final_score, rank=s.rank)
               for s in scored],
        total=len(scored),
    )
```

整段代码里 pydantic 只活在两个位置：**进来的请求** 和 **出去的响应**。中间所有"只在我们自己代码里活动"的对象，全是 dataclass。这是一种很朴素的边界感——pydantic 守门，dataclass 干活。

## 什么时候必须保留 pydantic

不是所有看起来"内部"的 model 都该被改成 dataclass。下面这些情况，老老实实留着 pydantic：

- **用了 validator**（`field_validator` / `model_validator`）—— 这些校验本身就是业务规则的载体
- **用了 `model_dump()` / `model_dump_json()`** 做序列化 —— pydantic 的 dump 比手写转换更稳
- **用了 `model_validate()` / `TypeAdapter`** 做反序列化 —— 输入来源不可信
- **用了 `ConfigDict`** 配字段别名、`from_attributes` 之类的特性
- **继承链上有 `BaseModel`** 且子类依赖父类的 schema 推导
- **配置类**（`pydantic-settings`）—— 启动时一次性校验，是非常划算的开销
- **被外部库以 pydantic 协议消费**（比如 LangChain 这种把 pydantic schema 当 tool 描述用的库）

辨认起来其实很机械——把这个 model 类的整个引用图扫一遍，看它有没有上面这些特性或这些用法。**没有任何一条命中的，那它就是一个伪装成 model 的 NamedTuple，可以下放到 dataclass。**

## 一个可以照抄的判断 checklist

每次新加一个数据结构时，先按下面这串问题走一遍：

```text
要加一个新的 data class
  │
  ├─ 这个数据来自外部（HTTP 请求 / 用户输入 / 第三方 API）？
  │     └─ 是 → pydantic BaseModel
  │
  ├─ 这个数据要序列化到外部（HTTP 响应 / 写消息队列）？
  │     └─ 是 → pydantic BaseModel
  │
  ├─ 这个数据需要业务规则校验（字段间不变式 / 自定义 validator）？
  │     └─ 是 → pydantic BaseModel
  │
  ├─ 这是配置（从 YAML / env 读的）？
  │     └─ 是 → pydantic-settings
  │
  ├─ 这个 model 会被 model_dump / model_validate / TypeAdapter 用？
  │     └─ 是 → pydantic BaseModel
  │
  └─ 否则
        └─ @dataclass(slots=True)
```

这套规则不是要"消灭 pydantic"，而是把它放回它该在的地方——**校验和序列化**。其他位置上，标准库 + 类型检查器已经能给你足够的安全感，没必要额外缴一份运行时校验税。

## 收尾

回到那个火焰图。把"纯数据容器"那一类换成 `@dataclass(slots=True)` 之后，再跑了一次同等压力的 profile，主热路径上 `pydantic.main.__init__` 的占比从 20%+ 掉到了零点几个百分点，相同 QPS 下 P95 也跟着下来一截。代码量倒没什么变化，受影响的也就是十来个类——但收益挺真实。

写到这里其实想说的话已经讲完了：

> 数据校验这件事，从来不是越多越好。它有明确的边界——边界之内是契约和安全，边界之外是无谓的开销。Pydantic 是非常好的工具，但用它的人也得知道自己什么时候用、为什么用。

下次起新项目，先想清楚这条边界画在哪。等到 flame graph 上 `pydantic.main.__init__` 已经长成一根粗柱子才回过头来想，其实就晚了一步——好在还来得及。

差不多就这样。
