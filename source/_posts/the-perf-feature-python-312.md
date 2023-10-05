---
title: 聊聊 Python 3.12 中 perf 的原生支持
type: tags
date: 2023-10-05 23:50:00
tags: [编程,Linux,笔记,水文,Python]
categories: [编程,Linux]
toc: true
---

好久没写 Python 相关的文章了，但是 Python 3.12 perf 原生支持的这个特性非常的棒，思路又新又好了属于是，所以写篇水文来聊聊这个特性

<!--more-->

## 正文

### 先聊聊 Python 的栈帧

在聊今天的正式内容之前我们需要理解 Python 在内存中的布局

对于传统的 native application 而言，大家对于其内存布局应该是比较熟悉的，这里以 x86-64 的一张图来说明其栈帧结构

![X86 栈帧](https://github.com/Zheaoli/zheaoli.github.io/assets/7054676/a1015149-4160-4f3c-b2da-dab8ff4ad2a4)

但是对于 CPython 来说，其 Native Code 执行的只是 VM 一层的代码。其在 VM 内单独抽象了一套类似 native 的栈帧结构。

其核心结构如下

```c
struct _frame {
    PyObject_HEAD
    PyFrameObject *f_back;      /* previous frame, or NULL */
    struct _PyInterpreterFrame *f_frame; /* points to the frame data */
    PyObject *f_trace;          /* Trace function */
    int f_lineno;               /* Current line number. Only valid if non-zero */
    char f_trace_lines;         /* Emit per-line trace events? */
    char f_trace_opcodes;       /* Emit per-opcode trace events? */
    char f_fast_as_locals;      /* Have the fast locals of this frame been converted to a dict? */
    /* The frame data, if this frame object owns the frame */
    PyObject *_f_frame_data[1];
};

typedef struct _PyInterpreterFrame {
    PyObject *f_executable; /* Strong reference */
    struct _PyInterpreterFrame *previous;
    PyObject *f_funcobj; /* Strong reference. Only valid if not on C stack */
    PyObject *f_globals; /* Borrowed reference. Only valid if not on C stack */
    PyObject *f_builtins; /* Borrowed reference. Only valid if not on C stack */
    PyObject *f_locals; /* Strong reference, may be NULL. Only valid if not on C stack */
    PyFrameObject *frame_obj; /* Strong reference, may be NULL. Only valid if not on C stack */
    // NOTE: This is not necessarily the last instruction started in the given
    // frame. Rather, it is the code unit *prior to* the *next* instruction. For
    // example, it may be an inline CACHE entry, an instruction we just jumped
    // over, or (in the case of a newly-created frame) a totally invalid value:
    _Py_CODEUNIT *prev_instr;
    int stacktop;  /* Offset of TOS from localsplus  */
    /* The return_offset determines where a `RETURN` should go in the caller,
     * relative to `prev_instr`.
     * It is only meaningful to the callee,
     * so it needs to be set in any CALL (to a Python function)
     * or SEND (to a coroutine or generator).
     * If there is no callee, then it is meaningless. */
    uint16_t return_offset;
    char owner;
    /* Locals and stack */
    PyObject *localsplus[1];
} _PyInterpreterFrame;
```

其在内存的组织结构大概如下所示

![Python 栈帧](https://github.com/Zheaoli/zheaoli.github.io/assets/7054676/06bda75b-0505-40b5-a0d8-4c815b21402b)

这里不难理解，每个栈帧中都包含了当前栈帧的上一个栈帧的指针，这样就形成了一个完整的栈结构。

同时我们能看到，在 Python 的栈帧结构中包含了很多重要的信息，

1. 当前执行的 opcode
2. 当前所对应的行号（类似于符号表存在）
3. 当前的局部，全局变量

我们所有的 trace/回溯的操作，都需要来基于这些信息来进行。

OK，在大致了解了 Python 的栈帧的一些入门知识后，我们接着往下聊

### 3.12 之前的一些尝试

我们通常对于在外部调试 Python 的时候，无外乎有两种需求

1. 去 trace 某一个函数的调用栈
2. 去采样不同函数在不同时间的调用（perf）

在 Python 3.12 之前，社区已经对于这样一些内容有了尝试

#### trace 的尝试

Python 目前对于 Trace 的尝试最早可以追溯到2014年，在 3.6 发布前夕，Python 提供了 DTrace 的支持，参见 Systemtap and DTrace support[<sup>1</sup>](#refer-anchor-1)

DTrace 是在 Unix/Linux 下提供的一种用户预置一些埋点的基础设施。在对应的函数预置埋点后，对应位置的调用可以触发外部的注册程序（包含 SystemTap/eBPF 等），从而实现对于一些调用时的动态 trace。

Python 提供了一部分预置的 Hook 点

```text
29564 python18035        python3.6          _PyEval_EvalFrameDefault function-entry
29565 python18035        python3.6             dtrace_function_entry function-entry
29566 python18035        python3.6          _PyEval_EvalFrameDefault function-return
29567 python18035        python3.6            dtrace_function_return function-return
29568 python18035        python3.6                           collect gc-done
29569 python18035        python3.6                           collect gc-start
29570 python18035        python3.6          _PyEval_EvalFrameDefault line
29571 python18035        python3.6                 maybe_dtrace_line line
```

然后下面是一个使用 systemtap 的例子

```stap
probe process("python").mark("function__entry") {
     filename = user_string($arg1);
     funcname = user_string($arg2);
     lineno = $arg3;

     printf("%s => %s in %s:%d\\n",
            thread_indent(1), funcname, filename, lineno);
}

probe process("python").mark("function__return") {
    filename = user_string($arg1);
    funcname = user_string($arg2);
    lineno = $arg3;

    printf("%s <= %s in %s:%d\\n",
           thread_indent(-1), funcname, filename, lineno);
}
```

效果差不多这样

```text
11408 python(8274):        => __contains__ in Lib/_abcoll.py:362
11414 python(8274):         => __getitem__ in Lib/os.py:425
11418 python(8274):          => encode in Lib/os.py:490
11424 python(8274):          <= encode in Lib/os.py:493
11428 python(8274):         <= __getitem__ in Lib/os.py:426
11433 python(8274):        <= __contains__ in Lib/_abcoll.py:366
```

但是目前来说，通过 DTrace 暴露的信息还比较少，在一些复杂的场景（比如多线程，协程），对于一个函数多次调用后，我们很难去将具体的函数关联到具体的调用栈中。

这个时候就需要涉及到去对于 Python 栈帧结构的处理了。虽然 USDT 没有将 FrameObject 指针传入到我们的注册 hook 程序中，不过要获取的话，实际上也不算太难

首先我们利用 readelf 看一下 Python 二进制中 `.note.stapsdt` section 中的内容，

```text
Displaying notes found in: .note.stapsdt
  Owner                Data size        Description
  stapsdt              0x00000045       NT_STAPSDT (SystemTap probe descriptors)
    Provider: python
    Name: function__entry
    Location: 0x00000000002693bf, Base: 0x00000000003f0fc9, Semaphore: 0x0000000000624110
    Arguments: 8@%rbp 8@%r12 -4@%eax
  stapsdt              0x00000046       NT_STAPSDT (SystemTap probe descriptors)
    Provider: python
    Name: function__return
    Location: 0x00000000002693ff, Base: 0x00000000003f0fc9, Semaphore: 0x0000000000624112
    Arguments: 8@%rbp 8@%r12 -4@%eax
  stapsdt              0x0000003b       NT_STAPSDT (SystemTap probe descriptors)
    Provider: python
    Name: line
    Location: 0x000000000010539e, Base: 0x00000000003f0fc9, Semaphore: 0x000000000062411c
    Arguments: 8@%r12 8@%rax -4@%r15d
  stapsdt              0x00000047       NT_STAPSDT (SystemTap probe descriptors)
    Provider: python
    Name: import__find__load__done
    Location: 0x00000000002a1450, Base: 0x00000000003f0fc9, Semaphore: 0x0000000000624124
    Arguments: 8@%rax -4@%edx
  stapsdt              0x00000040       NT_STAPSDT (SystemTap probe descriptors)
    Provider: python
    Name: import__find__load__start
    Location: 0x00000000002a1468, Base: 0x00000000003f0fc9, Semaphore: 0x0000000000624122
    Arguments: 8@%rax
  stapsdt              0x00000033       NT_STAPSDT (SystemTap probe descriptors)
    Provider: python
    Name: audit
    Location: 0x00000000002cd611, Base: 0x00000000003f0fc9, Semaphore: 0x0000000000624126
    Arguments: 8@%rbp 8@%rbx
  stapsdt              0x00000036       NT_STAPSDT (SystemTap probe descriptors)
    Provider: python
    Name: gc__start
    Location: 0x00000000002e6a9d, Base: 0x00000000003f0fc9, Semaphore: 0x000000000062411e
    Arguments: -4@120(%rsp)
  stapsdt              0x00000030       NT_STAPSDT (SystemTap probe descriptors)
    Provider: python
    Name: gc__done
    Location: 0x00000000002e70b4, Base: 0x00000000003f0fc9, Semaphore: 0x0000000000624120
    Arguments: -8@%rbx
```

我们能看到 function__entry 中起始的地址是 `0x00000000002693bf`，然后我们可以在 gdb 中将对应的部分反汇编出来

```text
   0x5555557bd3ef <dtrace_function_return+31>:  call   0x55555575be00 <PyUnicode_AsUTF8>
   0x5555557bd3f4 <dtrace_function_return+36>:  mov    %rbx,%rdi
   0x5555557bd3f7 <dtrace_function_return+39>:  mov    %rax,%r12
   0x5555557bd3fa <dtrace_function_return+42>:  call   0x5555557e38d0 <_PyInterpreterFrame_GetLine>
   0x5555557bd3ff <dtrace_function_return+47>:  nop
```

其中 NOP 指令是一个 trick，在外部有程序 attach 到进程上后，NOP 会被替换成 INT3 进入调试模式。

然后我们看到上一个调用是 call _PyInterpreterFrame_GetLine ，而这个函数的参数的原型是

```c
int _PyInterpreterFrame_GetLine(_PyInterpreterFrame *frame);
```

OK 基于 X86 的调用约定，rbi 用于存放函数第一个参数，即我们需要获取的 frame 对象，那么这里实际上在我们的 probe 程序中获取 rbx 寄存器的值就可以获取我们需要的 frame 对象了。

这样就能基于 DTrace 来完成一些 trace 的需求了。

但是目前基于 DTrace 的方案有这样一些问题

1. 不通用，需要在不同的平台上来反汇编获取对应的寄存器，同时不同的 Python 版本的寄存器位置也不一样（3.9 以下是 r15， 3.10/3.11 是 rbx）
2. Python 官方对于 Dtrace 的上心，导致 API 时不时的失灵，比如今天从4月份到现在，Dtrace function__entry 的 probe 点因为 PEP 669 的实现失效至今没法修，参见 Missing DTrace probes[<sup>2</sup>](#refer-anchor-2)
3. 粒度太粗了，每个函数都需要过一次 function__entry， 性能地狱

#### perf 类采样的尝试

其实这一部分可以了聊的东西相对没那么多，主流的工具，如同 py-spy 这样的都是通过 process_vm_readv 这样的奇怪的 syscall 来处理的。本质上还是对于 FrameObject 进行各种解析，缺陷差不多有这样一些

1. 内存读的 overhead 其实不小，这一部分其实是可以规避的
2. FrameObject 在不断的变化，导致需要对于不同的 FrameObject 做 Binding，这一点也会导致兼容性的问题。

### Python 3.12 的新尝试

我们都知道，对于非 NATIVE CODE 来说，perf 很多时候没有办法生效，因为你找不到对应的地址和具体的符号之间的映射，也无从谈起去采样。

好在 2009 年 Linux 3.x 之后，perf 提供新的功能，它允许用户往 `/tmp/perf-%d.map` 文件中写入地址与符号之间的映射，这样 perf 就可以通过这个文件来解析地址了。具体可以参见 perf report: Add support for profiling JIT generated code share[<sup>3</sup>](#refer-anchor-3)

在 Java/Node.js 都对于这个功能有了支持后，Python 也在 3.12 中提供了对于这个功能的支持，具体可以参见 gh-96143: Allow Linux perf profiler to see Python calls[<sup>4</sup>](#refer-anchor-4)

这个功能的实现其实是一种局部的 JIT，我们来看看具体的实现

```c
typedef PyObject *(*py_evaluator)(PyThreadState *, _PyInterpreterFrame *,
                                  int throwflag);
typedef PyObject *(*py_trampoline)(PyThreadState *, _PyInterpreterFrame *, int,
                                   py_evaluator);

extern void *_Py_trampoline_func_start;  // Start of the template of the
                                         // assembly trampoline
extern void *
    _Py_trampoline_func_end;  // End of the template of the assembly trampoline

struct code_arena_st {
    char *start_addr;    // Start of the memory arena
    char *current_addr;  // Address of the current trampoline within the arena
    size_t size;         // Size of the memory arena
    size_t size_left;    // Remaining size of the memory arena
    size_t code_size;    // Size of the code of every trampoline in the arena
    struct code_arena_st
        *prev;  // Pointer to the arena  or NULL if this is the first arena.
};

typedef struct code_arena_st code_arena_t;
typedef struct trampoline_api_st trampoline_api_t;

#define perf_status _PyRuntime.ceval.perf.status
#define extra_code_index _PyRuntime.ceval.perf.extra_code_index
#define perf_code_arena _PyRuntime.ceval.perf.code_arena
#define trampoline_api _PyRuntime.ceval.perf.trampoline_api
#define perf_map_file _PyRuntime.ceval.perf.map_file

static void
perf_map_write_entry(void *state, const void *code_addr,
                         unsigned int code_size, PyCodeObject *co)
{
    const char *entry = "";
    if (co->co_qualname != NULL) {
        entry = PyUnicode_AsUTF8(co->co_qualname);
    }
    const char *filename = "";
    if (co->co_filename != NULL) {
        filename = PyUnicode_AsUTF8(co->co_filename);
    }
    size_t perf_map_entry_size = snprintf(NULL, 0, "py::%s:%s", entry, filename) + 1;
    char* perf_map_entry = (char*) PyMem_RawMalloc(perf_map_entry_size);
    if (perf_map_entry == NULL) {
        return;
    }
    snprintf(perf_map_entry, perf_map_entry_size, "py::%s:%s", entry, filename);
    PyUnstable_WritePerfMapEntry(code_addr, code_size, perf_map_entry);
    PyMem_RawFree(perf_map_entry);
}

_PyPerf_Callbacks _Py_perfmap_callbacks = {
    NULL,
    &perf_map_write_entry,
    NULL,
};


static PyObject *
py_trampoline_evaluator(PyThreadState *ts, _PyInterpreterFrame *frame,
                        int throw)
{
    if (perf_status == PERF_STATUS_FAILED ||
        perf_status == PERF_STATUS_NO_INIT) {
        goto default_eval;
    }
    PyCodeObject *co = _PyFrame_GetCode(frame);
    py_trampoline f = NULL;
    assert(extra_code_index != -1);
    int ret = _PyCode_GetExtra((PyObject *)co, extra_code_index, (void **)&f);
    if (ret != 0 || f == NULL) {
        // This is the first time we see this code object so we need
        // to compile a trampoline for it.
        py_trampoline new_trampoline = compile_trampoline();
        if (new_trampoline == NULL) {
            goto default_eval;
        }
        trampoline_api.write_state(trampoline_api.state, new_trampoline,
                                   perf_code_arena->code_size, co);
        _PyCode_SetExtra((PyObject *)co, extra_code_index,
                         (void *)new_trampoline);
        f = new_trampoline;
    }
    assert(f != NULL);
    return f(ts, frame, throw, _PyEval_EvalFrameDefault);
default_eval:
    // Something failed, fall back to the default evaluator.
    return _PyEval_EvalFrameDefault(ts, frame, throw);
}
```


其实这里的思路很巧妙，有几个核心的点

1. 将默认的 _PyEval_EvalFrameDefault 替换为 py_trampoline_evaluator
2. 在 py_trampoline_evaluator 中，首先会去尝试从 FrameObject 中获取对应的 trampoline，如果没有的话，就会去编译一个 trampoline，然后将其写入到 perf map 文件中，同时将其缓存到 FrameObject 中，这样下次就可以直接从 FrameObject 中获取到对应的 trampoline 了。

那么怎么编译 trampline 呢？我们来看看具体的实现

```c
static int
new_code_arena(void)
{
    // non-trivial programs typically need 64 to 256 kiB.
    size_t mem_size = 4096 * 16;
    assert(mem_size % sysconf(_SC_PAGESIZE) == 0);
    char *memory =
        mmap(NULL,  // address
             mem_size, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS,
             -1,  // fd (not used here)
             0);  // offset (not used here)
    if (!memory) {
        PyErr_SetFromErrno(PyExc_OSError);
        _PyErr_WriteUnraisableMsg(
            "Failed to create new mmap for perf trampoline", NULL);
        perf_status = PERF_STATUS_FAILED;
        return -1;
    }
    void *start = &_Py_trampoline_func_start;
    void *end = &_Py_trampoline_func_end;
    size_t code_size = end - start;


    size_t n_copies = mem_size / code_size;
    for (size_t i = 0; i < n_copies; i++) {
        memcpy(memory + i * code_size, start, code_size * sizeof(char));
    }
    // Some systems may prevent us from creating executable code on the fly.
    int res = mprotect(memory, mem_size, PROT_READ | PROT_EXEC);
    if (res == -1) {
        PyErr_SetFromErrno(PyExc_OSError);
        munmap(memory, mem_size);
        _PyErr_WriteUnraisableMsg(
            "Failed to set mmap for perf trampoline to PROT_READ | PROT_EXEC",
            NULL);
        return -1;
    }


    invalidate_icache(memory, memory + mem_size);

    code_arena_t *new_arena = PyMem_RawCalloc(1, sizeof(code_arena_t));
    if (new_arena == NULL) {
        PyErr_NoMemory();
        munmap(memory, mem_size);
        _PyErr_WriteUnraisableMsg("Failed to allocate new code arena struct",
                                  NULL);
        return -1;
    }

    new_arena->start_addr = memory;
    new_arena->current_addr = memory;
    new_arena->size = mem_size;
    new_arena->size_left = mem_size;
    new_arena->code_size = code_size;
    new_arena->prev = perf_code_arena;
    perf_code_arena = new_arena;
    return 0;
}

static void
free_code_arenas(void)
{
    code_arena_t *cur = perf_code_arena;
    code_arena_t *prev;
    perf_code_arena = NULL;  // invalid static pointer
    while (cur) {
        munmap(cur->start_addr, cur->size);
        prev = cur->prev;
        PyMem_RawFree(cur);
        cur = prev;
    }
}

static inline py_trampoline
code_arena_new_code(code_arena_t *code_arena)
{
    py_trampoline trampoline = (py_trampoline)code_arena->current_addr;
    code_arena->size_left -= code_arena->code_size;
    code_arena->current_addr += code_arena->code_size;
    return trampoline;
}

static inline py_trampoline
compile_trampoline(void)
{
    if ((perf_code_arena == NULL) ||
        (perf_code_arena->size_left <= perf_code_arena->code_size)) {
        if (new_code_arena() < 0) {
            return NULL;
        }
    }
    assert(perf_code_arena->size_left <= perf_code_arena->size);
    return code_arena_new_code(perf_code_arena);
}
```

我们看到其实编译的操作本质上是从内存区域内新申请一块区域，然后将对应的 trampoline 拷贝到这个区域中，然后将这个区域设置为可执行的，这样就可以了。

而对于 trampoline 的实现，其实就是一个汇编的实现，我们来看看具体的实现

```asm
    .text
    .globl	_Py_trampoline_func_start
_Py_trampoline_func_start:
#ifdef __x86_64__
    sub    $8, %rsp
    call    *%rcx
    add    $8, %rsp
    ret
#endif // __x86_64__
#if defined(__aarch64__) && defined(__AARCH64EL__) && !defined(__ILP32__)
    // ARM64 little endian, 64bit ABI
    // generate with aarch64-linux-gnu-gcc 12.1
    stp     x29, x30, [sp, -16]!
    mov     x29, sp
    blr     x3
    ldp     x29, x30, [sp], 16
    ret
#endif
    .globl	_Py_trampoline_func_end
_Py_trampoline_func_end:
    .section        .note.GNU-stack,"",@progbits
```

我们看到这里的汇编其实就是一个简单的 call 操作，然后将返回值返回即可。等价于

```c
PyObject *
trampoline(PyThreadState *ts, _PyInterpreterFrame *f,
           int throwflag, py_evaluator evaluator)
{
    return evaluator(ts, f, throwflag);
}
```

那么我们其实这里的思路就不难理解了，我们在编译 trampoline 的时候，会将对应的 FrameObject 传入到 trampoline 中，然后我们在 perf map 文件写入的时候，实际上是将符号与内存中的一块固定区域进行了 binding。这样让我们的 perf 就可以通过 perf map 文件来解析对应的符号了。

那么我们来看看具体的 perf map 文件的内容

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

这样的好处有很多，我们可以利用 Linux 本身的 perf 生态，来完成很多基本的工作（比如火焰图）

同时我们在去做一些具体的函数的 trace 的时候，我们也可以利用 uprobe 之类的工具，基于我们在 perf 中写入的映射，来做更进一步的 trace，这也让整个 Python 程序的 trace 变的更容易，不用考虑汇编，不用考虑平台（其实也要考虑的（目前只有 ARM/X86 支持））

## 总结

Python 3.12 这个新特性真的是又新又好，实现的非常巧妙。其实之前和人讨论到 WASM 的 perf 的支持的时候，我第一反应也是可以参考 Python 中类似的做法，不过 WASM 先把自己的 WASI 搞成熟吧，不然花式 host function 也没啥 perf/trace 的必要了。

差不多就这样

## Reference

<div id="refer-anchor-1"></div>

- [1]. [https://github.com/python/cpython/issues/65789](https://github.com/python/cpython/issues/65789)

<div id="refer-anchor-2"></div>

- [2]. [https://github.com/python/cpython/issues/104280](https://github.com/python/cpython/issues/104280)

<div id="refer-anchor-3"></div>

- [3]. [https://lkml.org/lkml/2009/6/8/499](https://lkml.org/lkml/2009/6/8/499)

<div id="refer-anchor-4"></div>

- [4]. [https://github.com/python/cpython/pull/96123](https://github.com/python/cpython/pull/96123)
