---
title: 如何使用 WASMTIME 来运行 CPython for WASI，然后利用 Python 实现的 HostFunction 来扩展它？
type: tags
date: 2024-10-02 21:00:00
tags: [编程,CPython,WASI,WASM,笔记,水文]
categories: [编程,CPython]
toc: true
---

国庆节搞了一个活，利用 wasmtime 来执行编译成 WASM/WASI 字节码的 CPython 虚拟机，并在宿主机一侧利用 Python 实现的 Host Function 来扩展它。

再次声明一下，这个只是我个人想搞的活，没有再任何生产环境中得到验证，just for fun（XDDD

<!--more-->

## 正文

首先我们简单介绍一下 WASM/WASI，这里我直接引用一下 AI 生成的 brief summary

> WebAssembly (WASM) 是一种低级编程语言,可在现代网页浏览器中运行。它提供接近原生的性能。
> WebAssembly System Interface (WASI) 是 WASM 的一个标准扩展,允许 WASM 程序在浏览器外运行,访问系统资源。
> 这两项技术旨在提高 Web 应用性能,并使 WASM 在更多环境中可用。

而 WASM/WASI 技术路线核心的优势在于

1. 跨平台的兼容性
2. 多语言通过静态编译的支持
3. Native Sandbox 带来的安全性

所以 WASM/WASI 不仅在浏览器得到了广泛的应用， 现在其应用也逐渐扩展到了服务端。Serverless Compute，Database UDF， Gateway Plugin 等场景都在逐渐的铺开。

在最近在梳理 CPython 代码的时候，我突然有了一个想法，就是如果我用 WASM/WASI Runtime 来运行 CPython，然后在宿主机一侧利用 Python 实现的 Host Function 来扩展它，这样似乎能对一些比如允许用户上传自定义代码的数据 PaaS 这样的场景有所帮助。当然更主要的原因是这个 idea 貌似很好玩。

在我们继续往下走之前，我们感谢一个人，Brett Cannon， 他几乎以一己之力，完成了 CPython WASM/WASI 的支持。快跟我说 谢谢 Brett Cannon ！

CPython 整体的 WASM/WASI 演进路线如下

1. 最早于21年11月，通过 emscripten 支持了 WASM，参见 BPO-40280[<sup>1</sup>](#refer-anchor-1)
2. 在2023年6月成为官方支持的 Tier3 平台（或者更早?）
3. 在2024年3月，成为官方支持的 Tier2 平台，参见 GH-116314[<sup>2</sup>](#refer-anchor-2)
4. 从 Python 3.13 开始，传统的 emscripten 方式的 WASM/WASI 支持将被放弃

OK，那么我们先来将 CPython 编译为 WASM/WASI 字节码，这里需要提前 setup 你的环境，确保安装 WASI-SDK。这里我为了省事，直接使用官方提供的 devcontainer 来进行所有的操作

我们使用 vscode setup 好 devcontainer 后，我们执行 `python3 Tools/wasm/wasi.py build -- --config-cache --with-pydebug` 便可以编译了，这里为了省事，我将原本 wasi.py 设定的先提前预编译一遍 CPython 的部分给去除了

```python

def build_all(context):
    """Build everything."""
    steps = [
            #configure_build_python,
            #make_build_python,
            configure_wasi_python,
            make_wasi_python
        ]
```

在编译完成后，我们使用 `cross-build/wasm32-wasi/python.sh` 就可以运行我们的 CPython 了，这里实际上是 wrap 了一下 WASMTIME 的命令

```bash
#!/bin/sh
exec /usr/local/bin/wasmtime run --wasm max-wasm-stack=16777216 --wasi preview2 --dir /workspaces/cpython-wasi::/ --env PYTHONPATH=/cross-build/wasm32-wasi/build/lib.wasi-wasm32-3.14-pydebug /workspaces/cpython-wasi/cross-build/wasm32-wasi/python.wasm "$@"
```

这里我们可以看到，官方的推荐的 WASM/WASI Runtime 是 wasmtime，那么我们用 wasmtime 进行接下来的工作

由于我们后续想用 Host Function 来扩展这一套流程，所以我们将 bash 的部分重写一下，最开始我使用的是 wasmtime 的 Python binding，大致的代码如下

```python
from wasmtime import Linker, Engine, Store, WasiConfig, Module, FuncType, ValType, _bindings, Config
import sys

def test_wasi():
    linker = Linker(Engine())
    linker.define_wasi()
    with open("/workspaces/cpython-wasi/cross-build/wasm32-wasi/python.wasm", "rb") as file:
        module = Module(linker.engine, file.read())
    def foor_bar(a, b):
        return a + b
    linker.define_func("demo", "demo", FuncType([ValType.i32(),ValType.i32()],[ValType.i32()]), foor_bar)
    store = Store(linker.engine)
    config = Config()
    _bindings.wasmtime_config_max_wasm_stack_set(config.ptr(), 16777216)
    wasi_config = WasiConfig()
    # wasi_config.stdin_file = sys.stdin.fileno()
    # wasi_config.stdout_file = sys.stdout.fileno()
    # wasi_config.stderr_file = sys.stderr.fileno()
    wasi_config.env = [["PYTHONPATH", "/cross-build/wasm32-wasi/build/lib.wasi-wasm32-3.14-pydebug"]]
    wasi_config.inherit_stdout()
    wasi_config.inherit_stderr()
    wasi_config.inherit_stdin()
    wasi_config.preopen_dir("/workspaces/cpython-wasi","/")
    store.set_wasi(wasi_config)

    instance=linker.instantiate(store, module)
    instance.exports(store)["_start"](store)

test_wasi()
```

由于 wasmtime 的 Python binding 是直接走 ctype 的一套封装，很多 config 选项没有在对外暴露的 API 里（比如代码里使用的 wasmtime_config_max_wasm_stack_set 来处理 WASM 的 stack），导致很多操作需要使用没暴露的私有 API，太过于 tricky，所以我选择重新用 Rust 来实现这一套操作

```rust
use wasmtime::*;
use wasmtime_wasi::preview1::{self};
use wasmtime_wasi::WasiCtxBuilder;
fn main() {
    let mut config = Config::new();
    config.max_wasm_stack(16777216);
    match Engine::new(&config) {
        Ok(engine) => {
            let mut linker = Linker::new(&engine);
            preview1::add_to_linker_sync(&mut linker, |t| t).unwrap();
            linker.allow_unknown_exports(true);
            let mut builder = WasiCtxBuilder::new();
            builder.inherit_stdio();
            builder.env(
                "PYTHONPATH",
                "/cross-build/wasm32-wasi/build/lib.wasi-wasm32-3.14-pydebug",
            );
            builder
                .preopened_dir(
                    "/workspaces/cpython-wasi",
                    "/",
                    wasmtime_wasi::DirPerms::all(),
                    wasmtime_wasi::FilePerms::all(),
                )
                .unwrap();
            builder.args(&["--", "--version"]);
            let wasi_ctx = builder.build_p1();
            let mut store = Store::new(&engine, wasi_ctx);
            let module = Module::from_file(
                &engine,
                "/workspaces/cpython-wasi/cross-build/wasm32-wasi/python.wasm",
            )
            .unwrap();
            let instance = linker.instantiate(&mut store, &module).unwrap();
            let run = instance
                .get_typed_func::<(), ()>(&mut store, "_start")
                .unwrap();
            run.call(&mut store, ()).unwrap();
            return;
        }
        Err(e) => {
            println!("Error creating engine: {:?}", e);
            return;
        }
    }
}
```

然后我们执行代码，成功！

```bash
[root@267e91be24fd wasmtime-demo]# cargo run --release
   Compiling wasmtime-demo v0.1.0 (/workspaces/wasmtime-demo)
    Finished `release` profile [optimized] target(s) in 1.81s
     Running `target/release/wasmtime-demo`
Python 3.14.0a0
```

现在我们来扩展我们的 CPython。首先声明，由于 dlopen 在 WASM/WASI for CPython 中没有得到支持，所以我们需要更改 Python 的本体部分

首先，我们在 Python 的 Modules 目录下面新增一个文件，命名为 `demo.c`，内容如下

```c
#include <Python.h>

extern int demo(int a, int b) {
	return a + b;
}
static PyObject *
foo_bar(PyObject *self, PyObject *args)
{
	Py_INCREF(PyExc_TypeError);
	return PyLong_FromLong((long) demo(1, 2));
}

static PyMethodDef foomethods[] = {
	{"bar", foo_bar, METH_VARARGS, ""},
	{NULL, NULL, 0, NULL},
};

static PyModuleDef foomodule = {
	PyModuleDef_HEAD_INIT,
	.m_name = "demo",
	.m_doc = "foo test module",
	.m_size = -1,
	.m_methods = foomethods,
};

PyMODINIT_FUNC
PyInit_demo(void)
{
	return PyModule_Create(&foomodule);
}
```

然后我们在 `Modules/Setup.bootstrap.in` 中加入一行

```text
demo demo.c
```

接着重新执行命令 `python3 Tools/wasm/wasi.py build -- --config-cache --with-pydebug`，生成新的 WASM/WASI 字节码。接着我们将前面的 Rust 代码中，args 的部分改为 `["--", "-c", "import demo; print(demo.bar())"]`，然后重新执行代码，成功！

```bash
[root@267e91be24fd wasmtime-demo]# cargo run --release
   Compiling wasmtime-demo v0.1.0 (/workspaces/wasmtime-demo)
    Finished `release` profile [optimized] target(s) in 1.73s
     Running `target/release/wasmtime-demo`
3
```

现在，我们有了一个扩展模块，demo.c，但是问题是，我们现在的 demo.c 中核心的 `demo` 函数是 hardcode 在代码中。那么我们需要处理一下这里

通常来说，在常规的经验下，我们可以将函数的实现和定义分离开，这样方便动态链接。WASM/WASI 的也是类似，不过需要额外的处理

```c
extern int demo(int a, int b) __attribute__((
    __import_module__("demo"),
    __import_name__("demo"),
));
```

这里我们是通过扩展的宏定义，在编译期的时候告诉编译器，demo 函数是从 demo 模块中导入的。这样我们就可以在后续的 Host Function 中，根据约定进行扩展了

然后我们需要修改一下 CPython 的编译脚本，给编译参数添加上 `-Wextra -Wl,--allow-undefined`

接着重新执行 `python3 Tools/wasm/wasi.py build -- --config-cache --with-pydebug`，生成新的 WASM/WASI 字节码。这个时候我们可以先执行 `python.sh` 一下，我们会得到报错

```bash
Error: failed to run main module `/workspaces/cpython-wasi/cross-build/wasm32-wasi/python.wasm`

Caused by:
    0: failed to instantiate "/workspaces/cpython-wasi/cross-build/wasm32-wasi/python.wasm"
    1: unknown import: `demo::demo` has not been defined
```

符合预期。

那么我们现在来重新处理下我们的 Rust 代码

```rust
use wasmtime::*;
use wasmtime_wasi::preview1::{self};
use wasmtime_wasi::WasiCtxBuilder;
fn main() {
    let mut config = Config::new();
    config.max_wasm_stack(16777216);
    match Engine::new(&config) {
        Ok(engine) => {
            let mut linker = Linker::new(&engine);
            preview1::add_to_linker_sync(&mut linker, |t| t).unwrap();
            linker
                .func_wrap("demo", "demo", |a: i32, b: i32| {
                    (a+b)*10
                })
                .unwrap();
            linker.allow_unknown_exports(true);
            let mut builder = WasiCtxBuilder::new();
            builder.inherit_stdio();
            builder.env(
                "PYTHONPATH",
                "/cross-build/wasm32-wasi/build/lib.wasi-wasm32-3.14-pydebug",
            );
            builder
                .preopened_dir(
                    "/workspaces/cpython-wasi",
                    "/",
                    wasmtime_wasi::DirPerms::all(),
                    wasmtime_wasi::FilePerms::all(),
                )
                .unwrap();
            builder.args(&["--", "-c", "import demo; print(demo.bar())"]);
            let wasi_ctx = builder.build_p1();
            let mut store = Store::new(&engine, wasi_ctx);
            let module = Module::from_file(
                &engine,
                "/workspaces/cpython-wasi/cross-build/wasm32-wasi/python.wasm",
            )
            .unwrap();
            let instance = linker.instantiate(&mut store, &module).unwrap();
            let run = instance
                .get_typed_func::<(), ()>(&mut store, "_start")
                .unwrap();
            run.call(&mut store, ()).unwrap();
            return;
        }
        Err(e) => {
            println!("Error creating engine: {:?}", e);
            return;
        }
    }
}
```

执行一下，得到结果

```bash
[root@267e91be24fd wasmtime-demo]# cargo run --release
   Compiling wasmtime-demo v0.1.0 (/workspaces/wasmtime-demo)
    Finished `release` profile [optimized] target(s) in 1.79s
     Running `target/release/wasmtime-demo`
30
```

符合预期。

好了，现在我们支持了 Host Fucntion，我们可以在遵守函数签名的情况下，任意修改我们的逻辑。但是你还记得本文的标题吗？我们想执行 Python 实现的 Host Function。emmmm 虽然有一点绕，但也不是不可以，我们直接祭出 PyO3，更改 Rust 代码如下

```rust
use pyo3::prelude::*;
use pyo3::types::PyTuple;
use wasmtime::*;
use wasmtime_wasi::preview1::{self};
use wasmtime_wasi::WasiCtxBuilder;
fn main() {
    let mut config = Config::new();
    config.max_wasm_stack(16777216);
    match Engine::new(&config) {
        Ok(engine) => {
            let mut linker = Linker::new(&engine);
            preview1::add_to_linker_sync(&mut linker, |t| t).unwrap();
            linker
                .func_wrap("demo", "demo", |a: i32, b: i32| {
                    Python::with_gil(|py| {
                        let fun: Py<PyAny> = PyModule::from_code_bound(
                            py,
                            "def example(*args, **kwargs):
                                return (args[0] + args[1])*11",
                            "",
                            "",
                        )
                        .unwrap()
                        .getattr("example")
                        .unwrap()
                        .into();
                        let args = PyTuple::new_bound(py, &[a, b]);
                        // cast following to int

                        fun.call1(py, args).unwrap().extract::<i32>(py).unwrap()
                    })
                })
                .unwrap();
            linker.allow_unknown_exports(true);
            let mut builder = WasiCtxBuilder::new();
            builder.inherit_stdio();
            builder.env(
                "PYTHONPATH",
                "/cross-build/wasm32-wasi/build/lib.wasi-wasm32-3.14-pydebug",
            );
            builder
                .preopened_dir(
                    "/workspaces/cpython-wasi",
                    "/",
                    wasmtime_wasi::DirPerms::all(),
                    wasmtime_wasi::FilePerms::all(),
                )
                .unwrap();
            builder.args(&["--", "-c", "import demo; print(demo.bar())"]);
            let wasi_ctx = builder.build_p1();
            let mut store = Store::new(&engine, wasi_ctx);
            let module = Module::from_file(
                &engine,
                "/workspaces/cpython-wasi/cross-build/wasm32-wasi/python.wasm",
            )
            .unwrap();
            let instance = linker.instantiate(&mut store, &module).unwrap();
            let run = instance
                .get_typed_func::<(), ()>(&mut store, "_start")
                .unwrap();
            run.call(&mut store, ()).unwrap();
            return;
        }
        Err(e) => {
            println!("Error creating engine: {:?}", e);
            return;
        }
    }
}
```

然后执行一下，得到结果

```bash
[root@267e91be24fd wasmtime-demo]# cargo run --release
   Compiling wasmtime-demo v0.1.0 (/workspaces/wasmtime-demo)
    Finished `release` profile [optimized] target(s) in 1.75s
     Running `target/release/wasmtime-demo`
33
```

OK，我们成功了！

## 总结

本文实际上是一个技术路线的 PoC，验证了特定情况下，将 Python 和 WASI 结合的可能性，但是目前也暴露出一些问题

1. dlopen 支持的缺乏导致需要魔改 CPython runtime 本身的代码，不过根据 Brett Cannon 博客中提供的信息，有人 hack 了这一块代码提供了支持。感觉后续可以 follow up 一下
2. wasmtime Python binding 实在是太难用了，其实可以考虑直接基于 PyO3 进行一次封装
3. 利用 Rust 来处理 wasmtime ，PyO3 调用 Python 代码目前存在的问题是 Python VM 对象没法跨线程共享，可能需要自己基于 Rust 封装一套类似 Golang 这样的 channel 的思路来复用虚拟机和传递数据

不过总体来说，这个 PoC 还是很有意思的，希朋友们也能玩的开心

## 参考

<div id="refer-anchor-1"></div>

- [1]. <https://bugs.python.org/issue40280>

<div id="refer-anchor-2"></div>

- [2]. <https://github.com/python/cpython/issues/116314>
