---
title: Debug 日志：CPython GH-120437
type: tags
date: 2024-06-20 03:40:00
tags: [编程,CPython,笔记,水文]
categories: [编程,CPython]
toc: true
---

和 SRE 日志 系列一样，Debug 日志用来复盘我一些可以公开的调试经历，希望能帮助到大家。

这篇是 Python 3.13 Beta 下 JIT/Tier 2 优化器的一个 Bug ，前后历时五天，最终修改点很小，非常有趣

<!--more-->

## 开篇

13号的时候，用户反馈了一个 Bug，编号 GH120437[<sup>1</sup>](#refer-anchor-1) ，具体的行为是这样

Python 3.13 引入了实验性的 JIT 优化器，具体的细节可以参考我之前的文章 简单聊聊 Python 3.13 的 JIT 方案[<sup>2</sup>](#refer-anchor-2)，用户可以在构建的时候选择性的开启

> ./configure --enable-experimental-jit --with-pydebug && make -j

用户在开启 JIT 的情况下，发现了一个非常奇怪的问题，执行

> ./python -m ensurepip

会抛出异常

```text
subprocess.CalledProcessError: Command '['/home/jglass/Documents/cpython/python', '-W', 'ignore::DeprecationWarning', '-c', '\nimport runpy\nimport sys\nsys.path = [\'/tmp/tmpsu81mj6o/pip-24.0-py3-none-any.whl\'] + sys.path\nsys.argv[1:] = [\'install\', \'--no-cache-dir\', \'--no-index\', \'--find-links\', \'/tmp/tmpsu81mj6o\', \'pip\']\nrunpy.run_module("pip", run_name="__main__", alter_sys=True)\n']' died with <Signals.SIGABRT: 6>.
```

我在最新分支上无法复现这个问题，在3.13分支上能够稳定复现。

能够稳定复现就好办了。首先为了调试下去，我们需要在一个更小范围的能够复现的测试用例，我去阅读了一下 ensurepip 部分的代码，有关的部分大概长这样

```python
def _run_pip(args, additional_paths=None):
    # Run the bootstrapping in a subprocess to avoid leaking any state that happens
    # after pip has executed. Particularly, this avoids the case when pip holds onto
    # the files in *additional_paths*, preventing us to remove them at the end of the
    # invocation.
    code = f"""
import runpy
import sys
sys.path = {additional_paths or []} + sys.path
sys.argv[1:] = {args}
runpy.run_module("pip", run_name="__main__", alter_sys=True)
"""

    cmd = [
        sys.executable,
        '-W',
        'ignore::DeprecationWarning',
        '-c',
        code,
    ]
    if sys.flags.isolated:
        # run code in isolated mode if currently running isolated
        cmd.insert(1, '-I')
    return subprocess.run(cmd, check=True).returncode
```

那么这里我直接构造一个 Python 脚本，直接用 Python 来执行，理论上讲是没有问题的

```python
import runpy
import sys
sys.path = ['/tmp/tmp04bw2hi9/pip-23.3.2-py3-none-any.whl'] + sys.path
sys.argv[1:] = ['install', '--no-cache-dir', '--no-index', '--find-links', '/tmp/tmp04bw2hi9', 'pip']
runpy.run_module("pip", run_name="__main__", alter_sys=True)
```

bingo，这个脚本能够稳定复现问题，那么我们就可以开始进一步的分析问题了

我们现在要做的一个很关键的事是确认 Bug 引入的时间点和范围。那么这个问题理论上讲是 JIT 优化器引入的，JIT 第一个引入的 commit 是 f6d9e5926b6138994eaa60d1c36462e36105733d[<sup>3</sup>](#refer-anchor-3)，那么我们可以通过 git bisect 来确认问题的引入时间点（这里额外的确认是该 commit 前一个 commit 是没有问题的）

经过确认后，我们发现问题的引入时间点是 1ab6356ebec25f216a0eddbd81225abcb93f2d55[<sup>4</sup>](#refer-anchor-4)，那么我们就可以开始进一步的分析了

先上 gdb ，看一下栈的情况

```text
__pthread_kill_implementation (threadid=<optimized out>, signo=signo@entry=6, no_tid=no_tid@entry=0) at pthread_kill.c:44
44            return INTERNAL_SYSCALL_ERROR_P (ret) ? INTERNAL_SYSCALL_ERRNO (ret) : 0;                                                                                                                          
(gdb) bt
#0  __pthread_kill_implementation (threadid=<optimized out>, signo=signo@entry=6, no_tid=no_tid@entry=0) at pthread_kill.c:44
#1  0x00007ffff7d3eeb3 in __pthread_kill_internal (threadid=<optimized out>, signo=6) at pthread_kill.c:78
#2  0x00007ffff7ce6a30 in __GI_raise (sig=sig@entry=6) at ../sysdeps/posix/raise.c:26
#3  0x00007ffff7cce4c3 in __GI_abort () at abort.c:79
#4  0x00007ffff7cce3df in __assert_fail_base (fmt=0x7ffff7e59b68 "%s%s%s:%u: %s%sAssertion `%s' failed.\n%n", assertion=assertion@entry=0x7ffff69bb47c "tstate->datastack_top < tstate->datastack_limit", 
    file=file@entry=0x7ffff69bb431 "/home/manjusaka/Documents/projects/cpython/Include/internal/pycore_frame.h", line=line@entry=284, 
    function=function@entry=0x7ffff69bb4ac "_PyInterpreterFrame *_PyFrame_PushUnchecked(PyThreadState *, PyFunctionObject *, int)") at assert.c:94
#5  0x00007ffff7cdec67 in __assert_fail (assertion=0x7ffff69bb47c "tstate->datastack_top < tstate->datastack_limit", 
    file=0x7ffff69bb431 "/home/manjusaka/Documents/projects/cpython/Include/internal/pycore_frame.h", line=284, 
    function=0x7ffff69bb4ac "_PyInterpreterFrame *_PyFrame_PushUnchecked(PyThreadState *, PyFunctionObject *, int)") at assert.c:103
#6  0x00007ffff69b07e8 in ?? ()
#7  0x416b4a710a2907e9 in ?? ()
#8  0x00005555556c9023 in _Py_INCREF_IncRefTotal () at Objects/object.c:230
Backtrace stopped: previous frame inner to this frame (corrupt stack?)
```

What the fuck，这什么栈？我们能拿到的唯一的有效信息是崩溃在这里

```c
static inline _PyInterpreterFrame *
_PyFrame_PushUnchecked(PyThreadState *tstate, PyFunctionObject *func, int null_locals_from)
{
    CALL_STAT_INC(frames_pushed);
    PyCodeObject *code = (PyCodeObject *)func->func_code;
    _PyInterpreterFrame *new_frame = (_PyInterpreterFrame *)tstate->datastack_top;
    tstate->datastack_top += code->co_framesize;
    assert(tstate->datastack_top < tstate->datastack_limit);
    _PyFrame_Initialize(new_frame, func, NULL, code, null_locals_from);
    return new_frame;
}
```

其余的信息，没有。。。这也算 JIT 的坑了，由于是动态加载的二进制，会导致调试进程的时候会有很多额外的工作量。理论上我可以挂一下 frame 拿到 executor 的信息然后再调 JIT 的汇编的，但是我不想这么搞啊？

这里陷入了僵局，我在实在没想到很好的办法准备硬调的时候，遛狗时突然想起 Python 的 JIT 是基于 Copy and Patch 做的，是基于已有的 executor case 来生成 JIT 二进制的（具体细节还是参考我之前那篇文章）。那么我应该可以直接将 JIT 的部分关掉，只用 Tier2 优化器的 OPCODE 来测试，应该行为是一致的

重新基于 `./configure --with-pydebug --enable-pystats --enable-profiling --with-dtrace --enable-experimental-jit=interpreter` 来编译代码，用gdb 测试，果然，这次的栈美好了很多

```text
#1  0x00007ffff7d3eeb3 in __pthread_kill_internal (threadid=<optimized out>, signo=6) at pthread_kill.c:78
#2  0x00007ffff7ce6a30 in __GI_raise (sig=sig@entry=6) at ../sysdeps/posix/raise.c:26
#3  0x00007ffff7cce4c3 in __GI_abort () at abort.c:79
#4  0x00007ffff7cce3df in __assert_fail_base (fmt=0x7ffff7e59b68 "%s%s%s:%u: %s%sAssertion `%s' failed.\n%n", assertion=assertion@entry=0x55555591a150 "tstate->datastack_top < tstate->datastack_limit", 
    file=file@entry=0x555555901138 "./Include/internal/pycore_frame.h", line=line@entry=284, function=function@entry=0x555555977030 <__PRETTY_FUNCTION__.30> "_PyFrame_PushUnchecked") at assert.c:94
#5  0x00007ffff7cdec67 in __assert_fail (assertion=assertion@entry=0x55555591a150 "tstate->datastack_top < tstate->datastack_limit", file=file@entry=0x555555901138 "./Include/internal/pycore_frame.h", 
    line=line@entry=284, function=function@entry=0x555555977030 <__PRETTY_FUNCTION__.30> "_PyFrame_PushUnchecked") at assert.c:103
#6  0x000055555578ec88 in _PyFrame_PushUnchecked (tstate=tstate@entry=0x555555d9e0c0 <_PyRuntime+293952>, func=<optimized out>, null_locals_from=null_locals_from@entry=3)
    at ./Include/internal/pycore_frame.h:284
#7  0x00005555557b8c51 in _PyEval_EvalFrameDefault (tstate=0x555555d9e0c0 <_PyRuntime+293952>, frame=0x7ffff7f98e58, throwflag=0) at Python/executor_cases.c.h:3326
#8  0x00005555557bc37e in _PyEval_EvalFrame (tstate=tstate@entry=0x555555d9e0c0 <_PyRuntime+293952>, frame=<optimized out>, throwflag=throwflag@entry=0) at ./Include/internal/pycore_ceval.h:118
#9  0x00005555557bc4a4 in _PyEval_Vector (tstate=0x555555d9e0c0 <_PyRuntime+293952>, func=0x7ffff6fe10d0, locals=locals@entry=0x0, args=0x7fffffff15e0, argcount=2, kwnames=0x0) at Python/ceval.c:1818
#10 0x00005555556728e4 in _PyFunction_Vectorcall (func=<optimized out>, stack=<optimized out>, nargsf=<optimized out>, kwnames=<optimized out>) at Objects/call.c:413
#11 0x0000555555672c54 in _PyObject_VectorcallTstate (tstate=tstate@entry=0x555555d9e0c0 <_PyRuntime+293952>, callable=callable@entry=<function at remote 0x7ffff6fe10d0>, args=args@entry=0x7fffffff15e0, 
    nargsf=nargsf@entry=2, kwnames=kwnames@entry=0x0) at ./Include/internal/pycore_call.h:168
#12 0x0000555555673b8c in object_vacall (tstate=tstate@entry=0x555555d9e0c0 <_PyRuntime+293952>, base=base@entry=0x0, callable=<function at remote 0x7ffff6fe10d0>, vargs=vargs@entry=0x7fffffff1660)
    at Objects/call.c:819
#13 0x0000555555673cea in PyObject_CallMethodObjArgs (obj=0x0, name=<optimized out>) at Objects/call.c:880
#14 0x00005555557fb230 in import_find_and_load (tstate=tstate@entry=0x555555d9e0c0 <_PyRuntime+293952>, abs_name=abs_name@entry='_winapi') at Python/import.c:3080
#15 0x00005555557feb3a in PyImport_ImportModuleLevelObject (name=name@entry='_winapi', globals=<optimized out>, 
    locals=locals@entry={'__name__': 'mimetypes', '__doc__': 'Guess the MIME type of a file.\n\nThis module defines two useful functions:\n\nguess_type(url, strict=True) -- guess the MIME type and encoding of a URL.\n\nguess_extension(type, strict=True) -- guess the extension for a given MIME type.\n\nIt also contains the following, for tuning the behavior:\n\nData:\n\nknownfiles -- list of files to parse\ninited -- flag set when init() has been called\nsuffix_map -- dictionary mapping suffixes to suffixes\nencodings_map -- dictionary mapping suffixes to encodings\ntypes_map -- dictionary mapping suffixes to types\n\nFunctions:\n\ninit([files]) -- parse a list of files, default knownfiles (on Windows, the\n  default values are taken from the registry)\nread_mime_types(file) -- parse one file, return a dictionary or None\n', '__package__': '', '__loader__': <SourceFileLoader(name='mimetypes', path='/home/manjusaka/Documents/projects/cpython/Lib/mimetypes.py') at remote 0x7ffff5395100>, '__spec__': <ModuleSpec(name='mimetypes', loader...(truncated), fromlist=fromlist@entry=('_mimetypes_read_windows_registry',), level=level@entry=0) at Python/import.c:3160
#16 0x000055555578f3fa in import_name (tstate=tstate@entry=0x555555d9e0c0 <_PyRuntime+293952>, frame=frame@entry=0x7ffff7f98b18, name='_winapi', fromlist=fromlist@entry=('_mimetypes_read_windows_registry',), 
    level=level@entry=0) at Python/ceval.c:2629
#17 0x00005555557a244b in _PyEval_EvalFrameDefault (tstate=0x555555d9e0c0 <_PyRuntime+293952>, frame=0x7ffff7f98b18, throwflag=0) at Python/generated_cases.c.h:3196
#18 0x00005555557bc37e in _PyEval_EvalFrame (tstate=tstate@entry=0x555555d9e0c0 <_PyRuntime+293952>, frame=<optimized out>, throwflag=throwflag@entry=0) at ./Include/internal/pycore_ceval.h:118
```

这个栈看着就轻松很多了，我们很轻松的来到 #7 ，判断出当前的 opcode `_INIT_CALL_PY_EXACT_ARGS_x`，这是一个 Tier2 的特化指令，这里可以近似的认为我们对于这个指令有足够的上下文，比如函数初始化的时候参数有两个（对应此处的 _INIT_CALL_PY_EXACT_ARGS_2),然后有一些 short pass，在这个 short pass 中，_PyFrame_PushUnchecked 会被快速调用（免去了额外的 frame 大小的校验）。那么我最开始的想法是这样，我可以在这个指令的特化逻辑加一个额外的 check，如果当前的线程状态中保存的栈大小小于我们需要的大小，那么则退出特化，走传统的调用方式，那么更改起来也相对简单，`_INIT_CALL_PY_EXACT_ARGS_x` 有一个前置指令是 `_CHECK_FUNCTION_EXACT_ARGS`

```c
op(_CHECK_FUNCTION_EXACT_ARGS, (func_version/2, callable, self_or_null, unused[oparg] -- callable, self_or_null, unused[oparg])) {
    EXIT_IF(!PyFunction_Check(callable));
    PyFunctionObject *func = (PyFunctionObject *)callable;
    EXIT_IF(func->func_version != func_version);
    PyCodeObject *code = (PyCodeObject *)func->func_code;
    EXIT_IF(code->co_argcount != oparg + (self_or_null != NULL));
}
```

那么我们可以在这里添加一个额外的特化处理逻辑，如果当前的线程状态中保存的栈大小小于我们需要的大小，那么则退出特化，走传统的调用方式

```c
op(_CHECK_FUNCTION_EXACT_ARGS, (func_version/2, callable, self_or_null, unused[oparg] -- callable, self_or_null, unused[oparg])) {
    EXIT_IF(!PyFunction_Check(callable));
    PyFunctionObject *func = (PyFunctionObject *)callable;
    EXIT_IF(func->func_version != func_version);
    PyCodeObject *code = (PyCodeObject *)func->func_code;
    EXIT_IF(code->co_argcount != oparg + (self_or_null != NULL));
    EXIT_IF(!_PyThreadState_HasStackSpace(tstate, code->co_framesize));
}
```

编译后通过测试，问题解决，我开始提交 PR。你是不是以为到这里就完事了？不，这里我犯了一个很典型的错误就是，逻辑没有闭环，我没有解释清楚，为什么在 1ab6356ebec25f216a0eddbd81225abcb93f2d55[<sup>4</sup>](#refer-anchor-4) 引入了这个 Bug？查问题的时候逻辑闭环是个非常重要的事情

在提交 PR 后，核心开发者 Ken Jin（也是我现在的 Mentor）提醒我，这里的问题实际上可能和 `_INIT_CALL_PY_EXACT_ARGS_x` 毫无关联，而是 `_CHECK_STACK_SPACE` 特化的一个问题

他之所以能确定这一点，是因为他在看到这个问题的时候将 `_CHECK_STACK_SPACE` 的部分注释掉后，发现这个地方能够正常的运行。那么通常来说一个 Bug 只能有一个原因，那么我现在需要来查一查为什么 `_CHECK_STACK_SPACE` 会导致这个问题

这里要介绍下 `_CHECK_STACK_SPACE` 特化，是在 GH-116168[<sup>5</sup>](#refer-anchor-5) 中引入的，这个特化的目的是为了在特定的情况下，我们可以合并一些栈的检查，这个特化的逻辑是这样

假设我们有这样的顺序调用，字节码如下

```text
_CHECK_STACK_SPACE A
_PUSH_FRAME
_POP_FRAME
_CHECK_STACK_SPACE B
_PUSH_FRAME
_POP_FRAME
```

那么我们可以确定这个函数需要的大小是 max(A,B)，那我们特化的后的指令如下

```text
_CHECK_STACK_SPACE max(A, B)
_PUSH_FRAME
_POP_FRAME
_PUSH_FRAME
_POP_FRAME
```

对于嵌套调用

```text
_CHECK_STACK_SPACE A
_PUSH_FRAME
_CHECK_STACK_SPACE B
_PUSH_FRAME
_POP_FRAME
_POP_FRAME
```

那么我们可以确定这个函数需要的大小是 A + B，那我们特化的后的指令如下

```text
_CHECK_STACK_SPACE A + B
_PUSH_FRAME
_PUSH_FRAME
_POP_FRAME
_POP_FRAME
```

实现上来说，在第一次调用 `_CHECK_STACK_SPACE` 的时候，会有这样的逻辑

```c
case _CHECK_STACK_SPACE: {
    assert(corresponding_check_stack == NULL);
    corresponding_check_stack = &buffer[pc];
    break;
}
```

我们将当前指令放在 corresponding_check_stack 中，然后在第一次调用 `_PUSH_FRAME` 的时候，我们会有这样的逻辑

```c
max_space = curr_space > max_space ? curr_space : max_space;
if (first_valid_check_stack == NULL) {
    first_valid_check_stack = corresponding_check_stack;
}
else {
    // delete all but the first valid _CHECK_STACK_SPACE
    corresponding_check_stack->opcode = _NOP;
}
corresponding_check_stack = NULL;
break;
```

在最后第一次执行完成的时候，我们会有这样的逻辑

```c
finish:
    if (first_valid_check_stack != NULL) {
        assert(first_valid_check_stack->opcode == _CHECK_STACK_SPACE);
        assert(max_space > 0);
        assert(max_space <= INT_MAX);
        assert(max_space <= INT32_MAX);
        first_valid_check_stack->opcode = _CHECK_STACK_SPACE_OPERAND;
        first_valid_check_stack->operand = max_space;
    }
```

这里实际上是将 `_CHECK_STACK_SPACE` 的逻辑合并到了 `_CHECK_STACK_SPACE_OPERAND` 中，然后新指令的操作数是我们在执行过程中确认的当前我们需要的最大的 frame，那么我们可以看到，这里的逻辑是没有问题的，那么问题出在哪里呢？

在 1ab6356ebec25f216a0eddbd81225abcb93f2d55[<sup>4</sup>](#refer-anchor-4) 中，作者将在引入的新指令 `_PY_FRAME_GENERAL` 中 `first_valid_check_stack` 设置为 NULL，这会导致最后的指令替换的逻辑没法执行，同时我们在 `_PUSH_FRAME` 中将后续的 `_CHECK_STACK_SPACE` 指令替换为了 `_NOP`，这会导致我们 stack check 事实上的失效，最终导致进程的 crash

在确定最终的 root cause 后，这个问题就可以被修复了（就一行有效变更）

## 总结

这个问题是典型的查起来麻烦，修起来简单的问题，不过这个查 bug 过程我觉得挺有价值的，所以单独记录一下吧。以及 Python 的 Tier2 优化器设计真的蛮有趣的，希望后面能发现更多好玩的点（我目前在尝试做常量类型 Guard 的优化，希望能顺利）

差不多这样

## Reference

<div id="refer-anchor-1"></div>

- [1]. <https://github.com/python/cpython/issues/120437>

<div id="refer-anchor-2"></div>

- [2]. <https://www.manjusaka.blog/posts/2024/01/03/a-simple-introduction-about-python-jit/>

<div id="refer-anchor-3"></div>

- [3]. <https://github.com/python/cpython/commit/f6d9e5926b6138994eaa60d1c36462e36105733d>

<div id="refer-anchor-4"></div>

- [4]. <https://github.com/python/cpython/commit/1ab6356ebec25f216a0eddbd81225abcb93f2d55>

<div id="refer-anchor-5"></div>

- [5]. <https://github.com/python/cpython/issues/116168>