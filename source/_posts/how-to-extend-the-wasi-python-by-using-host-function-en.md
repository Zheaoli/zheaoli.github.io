---
title: How to Run CPython for WASI Using WASMTIME and Extend It with Python-Implemented Host Functions?
type: tags
date: 2024-10-02 21:00:00
tags: [编程, CPython, WASI, WASM, Notes, Blog]
categories: [编程, CPython]
toc: true
---

During the National Day holiday, I worked on a project to use wasmtime to execute CPython virtual machine compiled into WASM/WASI bytecode, and extend it with Host Functions implemented in Python on the host side.

I'd like to clarify again that this is just a personal project I wanted to work on, without any validation in production environments, just for fun (XDDD

<!--more-->

## Main Content

First, let's briefly introduce WASM/WASI. Here, I'll directly quote an AI-generated brief summary:

> WebAssembly (WASM) is a low-level programming language that can run in modern web browsers. It provides near-native performance.
> WebAssembly System Interface (WASI) is a standard extension of WASM that allows WASM programs to run outside the browser and access system resources.
> These two technologies aim to improve Web application performance and make WASM available in more environments.

The core advantages of the WASM/WASI technology route are:

1. Cross-platform compatibility
2. Multi-language support through static compilation
3. Security brought by Native Sandbox

Therefore, WASM/WASI is not only widely used in browsers but is also gradually expanding to the server-side. Scenarios such as Serverless Compute, Database UDF, and Gateway Plugin are gradually being rolled out.

While reviewing CPython code recently, I suddenly had an idea: what if I use WASM/WASI Runtime to run CPython, and then extend it with Host Functions implemented in Python on the host side? This seems to be helpful for scenarios like data PaaS that allows users to upload custom code. Of course, the main reason is that this idea seems quite interesting.

Before we continue, let's thank one person, Brett Cannon, who almost single-handedly completed the support for CPython WASM/WASI. Say thank you to Brett Cannon with me!

The overall WASM/WASI evolution route of CPython is as follows:

1. As early as November 2021, WASM was supported through emscripten, see BPO-40280[<sup>1</sup>](#refer-anchor-1)
2. It became an officially supported Tier3 platform in June 2023 (or earlier?)
3. It became an officially supported Tier2 platform in March 2024, see GH-116314[<sup>2</sup>](#refer-anchor-2)
4. Starting from Python 3.13, the traditional emscripten method of WASM/WASI support will be abandoned

OK, let's start by compiling CPython into WASM/WASI bytecode. You need to set up your environment in advance and make sure WASI-SDK is installed. To save time, I directly use the official devcontainer for all operations.

After setting up the devcontainer with vscode, we can compile by executing `python3 Tools/wasm/wasi.py build -- --config-cache --with-pydebug`. To save time, I removed the part in wasi.py that pre-compiles CPython:

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

After compilation, we can run our CPython using `cross-build/wasm32-wasi/python.sh`. This is actually a wrapper for the WASMTIME command:

```bash
#!/bin/sh
exec /usr/local/bin/wasmtime run --wasm max-wasm-stack=16777216 --wasi preview2 --dir /workspaces/cpython-wasi::/ --env PYTHONPATH=/cross-build/wasm32-wasi/build/lib.wasi-wasm32-3.14-pydebug /workspaces/cpython-wasi/cross-build/wasm32-wasi/python.wasm "$@"
```

We can see that the officially recommended WASM/WASI Runtime is wasmtime, so we'll use wasmtime for our next steps.

Since we want to use Host Functions to extend this process later, we'll rewrite the bash part. Initially, I used wasmtime's Python binding, and the code looked roughly like this:

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

Since wasmtime's Python binding is a direct ctype wrapper, many config options are not exposed in the public API (such as using wasmtime_config_max_wasm_stack_set to handle WASM's stack), which leads to many operations requiring the use of unexposed private APIs. This is too tricky, so I chose to reimplement this set of operations using Rust:

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

Then we execute the code, success!

```bash
[root@267e91be24fd wasmtime-demo]# cargo run --release
   Compiling wasmtime-demo v0.1.0 (/workspaces/wasmtime-demo)
    Finished `release` profile [optimized] target(s) in 1.81s
     Running `target/release/wasmtime-demo`
Python 3.14.0a0
```

Now let's extend our CPython. First, note that since dlopen is not supported in WASM/WASI for CPython, we need to modify the Python core itself.

First, we add a new file in Python's Modules directory, named `demo.c`, with the following content:

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

Then we add a line in `Modules/Setup.bootstrap.in`:

```text
demo demo.c
```

Next, we re-execute the command `python3 Tools/wasm/wasi.py build -- --config-cache --with-pydebug` to generate new WASM/WASI bytecode. Then we change the args part in our previous Rust code to `["--", "-c", "import demo; print(demo.bar())"]`, and re-execute the code, success!

```bash
[root@267e91be24fd wasmtime-demo]# cargo run --release
   Compiling wasmtime-demo v0.1.0 (/workspaces/wasmtime-demo)
    Finished `release` profile [optimized] target(s) in 1.73s
     Running `target/release/wasmtime-demo`
3
```

Now, we have an extension module, demo.c, but the problem is that the core `demo` function in our current demo.c is hardcoded. So we need to handle this.

Typically, in regular practice, we can separate the implementation and definition of functions to facilitate dynamic linking. WASM/WASI is similar, but requires additional handling:

```c
extern int demo(int a, int b) __attribute__((
    __import_module__("demo"),
    __import_name__("demo"),
));
```

Here, we use extended macro definitions to tell the compiler at compile time that the demo function is imported from the demo module. This way, we can extend it in subsequent Host Functions according to the convention.

Then we need to modify CPython's compilation script, adding `-Wextra -Wl,--allow-undefined` to the compilation parameters.

Next, re-execute `python3 Tools/wasm/wasi.py build -- --config-cache --with-pydebug` to generate new WASM/WASI bytecode. At this point, we can first execute `python.sh`, and we'll get an error:

```bash
Error: failed to run main module `/workspaces/cpython-wasi/cross-build/wasm32-wasi/python.wasm`

Caused by:
    0: failed to instantiate "/workspaces/cpython-wasi/cross-build/wasm32-wasi/python.wasm"
    1: unknown import: `demo::demo` has not been defined
```

This is as expected.

So now let's reprocess our Rust code:

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

Execute it, and we get the result:

```bash
[root@267e91be24fd wasmtime-demo]# cargo run --release
   Compiling wasmtime-demo v0.1.0 (/workspaces/wasmtime-demo)
    Finished `release` profile [optimized] target(s) in 1.79s
     Running `target/release/wasmtime-demo`
30
```

As expected.

Alright, now we support Host Functions, and we can modify our logic arbitrarily while adhering to the function signature. But do you remember the title of this article? We want to execute Python-implemented Host Functions. Hmm, although it's a bit roundabout, it's not impossible. Let's directly bring out PyO3 and modify our Rust code as follows:

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

Then execute it, and we get the result:

```bash
[root@267e91be24fd wasmtime-demo]# cargo run --release
   Compiling wasmtime-demo v0.1.0 (/workspaces/wasmtime-demo)
    Finished `release` profile [optimized] target(s) in 1.75s
     Running `target/release/wasmtime-demo`
33
```

OK, we succeeded!

## Summary

This article is actually a Proof of Concept (PoC) for a technical route, verifying the possibility of combining Python and WASI in specific situations. However, it also exposes some problems:

1. The lack of dlopen support requires modifying the CPython runtime code itself. However, according to information provided in Brett Cannon's blog, someone has hacked this part of the code to provide support. It feels like we can follow up on this later.
2. The wasmtime Python binding is really difficult to use. We could consider wrapping it once based on PyO3.
3. Using Rust to handle wasmtime and PyO3 to call Python code currently has the problem that Python VM objects cannot be shared across threads. We might need to encapsulate a set of channels similar to Golang based on Rust to reuse the virtual machine and pass data.

However, overall, this PoC is still very interesting. I hope friends can also have fun playing with it.

## References

<div id="refer-anchor-1"></div>

- [1]. <https://bugs.python.org/issue40280>

<div id="refer-anchor-2"></div>

- [2]. <https://github.com/python/cpython/issues/116314>