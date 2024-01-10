---
title: Python 3.12：一个被人忽略的史诗级版本
type: tags
date: 2023-10-30 03:49:00
tags: [编程,Linux,Python,笔记,水文]
categories: [编程,Python]
toc: true
---

Python 3.12 已经发布了一段时间，所以写篇水文来聊一聊这个常常被人忽略的史诗级版本。

## 正文

Python 3.12 绝对是一个史诗级版本，在我心目中，它对于 Python 的意义，大于 "async/await" 的 Python 3.5 和 "Type Hint" 的 Python 3.6 对于 Python 的意义。

或者我们可以这么说**在未来数年的时间里，Python 后续的很多意义重大的变更，其都能上溯到 Python 3.12**。

理解我这一个观点，我们来说一下 Python 的几大痛点：

1. Python 的可调试性，可观测性问题。历史上 Python 中做 Cost 的消耗极大，同时没有足够的手段可以从旁路去观察 Python 的运行时行为
2. Python GIL 问题，这个老生长谈了，不多说
3. Python 的 C API/ABI 问题，之前暴露的 C API/ABI 通常和 CPython VM 实现细节耦合，导致跨版本兼容性会是一个问题

而这样一些问题，Python 3.12 上都有了极大的进步

1. PEP 669， GH-96143 极大提升了 Python 的可观测性，可调试性
2. PEP 684， A Per-Interpreter GIL， 提升 Python 进程内性能，为后续的 non-GIL 打下了良好的基础
3. PEP 697 全新的 C API，进一步解耦 API/ABI 与 CPython VM 实现细节的耦合

我们下面分别来聊聊这一些变更

### 可观测性的提升

先聊聊 PEP 669，PEP 669 其实是受 PEP 659 启发的一个 PEP。在此之前，Python 内部事件的监控非常的困难，或者说代价极为高昂。以之前 laike9m 做的 Cyberbrain 这样一个工具来说，它能实现如下的调试效果

![Cyberbrain](https://user-images.githubusercontent.com/2592205/95418789-1820b480-08ed-11eb-9b3e-61c8cdbf187a.png)

通过这个功能能很方便的调试函数的各种调用栈和入参。实际上这样的实现整体上基于 `sys.settrace` 这样一套 API 来做的。会非常的慢，原因是在于每一个栈帧的调用都会触发一次 `sys.settrace` 的调用，可谓是在主干道上疯狂堵塞了。

而 PEP 669 则不一样，它存在两种 level

1. Global Callback
2. Code Block Callback

换句话说，可以让我们根据场景来选择不同的实现粒度（按照官方的 Benchmark，比 PEP 523 快了数个数量级）

同时 PEP 669 也实现了完整的一套 Event 语义

1. PY_START: Start of a Python function (occurs immediately after the call, the callee’s frame will be on the stack)
2. PY_RESUME: Resumption of a Python function (for generator and coroutine functions), except for throw() calls.
3. PY_THROW: A Python function is resumed by a throw() call.
4. PY_RETURN: Return from a Python function (occurs immediately before the return, the callee’s frame will be on the stack).
5. PY_YIELD: Yield from a Python function (occurs immediately before the yield, the callee’s frame will be on the stack).
6. PY_UNWIND: Exit from a Python function during exception unwinding.
7. CALL: A call in Python code (event occurs before the call).
8. C_RETURN: Return from any callable, except Python functions (event occurs after the return).
9. C_RAISE: Exception raised from any callable, except Python functions (event occurs after the exit).
10. RAISE: An exception is raised, except those that cause a STOP_ITERATION event.
11. EXCEPTION_HANDLED: An exception is handled.
12. LINE: An instruction is about to be executed that has a different line number from the preceding instruction.
13. INSTRUCTION – A VM instruction is about to be executed.
14. JUMP – An unconditional jump in the control flow graph is made.
15. BRANCH – A conditional branch is taken (or not).
16. STOP_ITERATION – An artificial StopIteration is raised; see the STOP_ITERATION event.、

对比一下 `sys.settrace` 提供的事件

1. call
2. line
3. return
4. exception
5. opcode

什么叫又新又好啊？通过 PEP 669，我们可以很方便的去实现性能更好的调试器，低成本的对 hot path 进行调用统计等很多操作

PEP 669，先告一段落，接着继续往下聊，GH-96143，也是一个贼为重要 PR

我们都知道，对于解释性语言在旁路 trace 最难做的一个事情，就是你很难能将内存中的地址和现在执行的代码关联起来（因为直接地址是没有意义的）。而 GH-96143 则是做了一个极简化的 JIT，将 Python 的 code block 和内存地址锚定，可以让我们在旁路直接 trace 内存地址。一个效果

```text
7f0caf8aa70c b py::_path_abspath:<frozen importlib._bootstrap_external>
7f0caf8aa717 b py::_path_isabs:<frozen importlib._bootstrap_external>
7f0caf8aa722 b py::FileFinder._fill_cache:<frozen importlib._bootstrap_external>
7f0caf8aa72d b py::execusercustomize:<frozen site>
7f0caf8aa738 b py::_read_directory:<frozen zipimport>
7f0caf8aa743 b py::FileLoader.__init__:<frozen importlib._bootstrap_external>
7f0caf8aa74e b py::<module>:/home/manjusaka/Documents/projects/cpython/demo.py
7f0caf8aa759 b py::baz:/home/manjusaka/Documents/projects/cpython/demo.py
7f0caf8aa764 b py::bar:/home/manjusaka/Documents/projects/cpython/demo.py
7f0caf8aa76f b py::foo:/home/manjusaka/Documents/projects/cpython/demo.py
```

具体的实现可以参考我另外一篇文章，这里就不展开了。终于算是补全了其余语言已经出现很早的功能了

### GIL 的改进

众所周知，Python 祖传的被黑的的地方是 GIL，或者说 GIL 给它带来了很多比如简化开发者代码心智负担的优势以外，也给带来额外的黑点。在~~降本增效~~，啊不对，性能提升越来越重要的今天，我们需要来尽可能的规避 GIL 所带来的性能问题

但是 GIL 不是那么好移除的，因为 Python 不少的状态都是全局状态，其设计的一部分假设就是 GIL 所带来的线程安全性，很典型的例子有

1. GC
2. 内存分配器
3. 不同对象的安全性等

在我们继续推进 non-GIL 之前，我们需要将关键状态从全局解耦。PEP 684 其实就是起到了这样的作用。除了引入 per-interpreter 的 GIL 以外。它最重要的意义莫过于将包括 GC 状态在内的一系列关键状态，下放至 interpreter 的级别。为后续的 non-GIL 落地打下了很坚实的基础

### C API/ABI 的改进

Python C API/ABI 一直是一个老大难问题，因为一度和 Python VM 的 API 耦合的非常紧密。Python 官方也意识到了这个问题，从 Python 3.2 引入 Limited API，到 PEP 652 ，Python 一直在试图提供稳定，跨版本的 API，但是始终有一环没有闭环，那就是对于类型的处理

比如说，我们 Rust/C++ 之类的 Binding，通常可能会在 Python 标准类型的基础上进行一部分派生，中间存入自己的状态。那么我们最开始的写法是（也只能是）

```c
typedef struct {
    PyListObject list;
    int state;
} SubListObject;
```

那么你觉得这段代码有什么问题吗？可能你发现了，这段代码，直接依赖了 Python 的 PyListObject，这样一个数据结构实际上是内部的实现细节，它的内存布局，兼容性随时可能随着版本变化而变化。所以 PEP 697 就尝试去填补上 Python Stable API/ABI 这最后一环

在 697 后，我们可以这样实现我们的代码

```c
typedef struct {
    int state;
} SubListState;

static PyObject * update_state(PyObject *module, PyObject *args) {
    PyType_Spec sub_spec = {
        .name = "_testcapi.Sub",
        .basicsize = sizeof(SubListState),
        .flags = Py_TPFLAGS_DEFAULT,
        .slots = empty_slots,
    };
    PyObject *base = PyList_New(1);
    PyObject *sub = PyType_FromMetaclass(NULL, module, &sub_spec, base);
    if (!sub) {
        goto finally;
    }
    instance = PyObject_CallNoArgs(sub);
    if (!instance) {
        goto finally;
    }
    void *data_ptr = PyObject_GetTypeData(instance, (PyTypeObject *)sub);
    if (!data_ptr) {
        goto finally;
    }
    SubListState *state = (SubListState *)data_ptr;
    state->state = 1;
finally:
    Py_XDECREF(instance);
    Py_XDECREF(sub);
    Py_XDECREF(base);
    return Py_None;
}
```

我们能看到，我们能直接将我们想要在数据结构中扩展的部分直接 attach 到基类上，而无须关心其细节。这样一来，我们就能够在不同版本的 Python 上，保证 ABI 的兼容性了

## 总结

很多人在去判断一门语言新版本的时候，会从语法糖等角度去判断，但是我自己更喜欢从它的稳定性等常常被人忽略的角度去判断。我对于 Python 3.12 的一个最直观的评价就是**在可观测性，调试性，API/ABI 稳定性上，终于和其余语言站在了同一水平线上**
