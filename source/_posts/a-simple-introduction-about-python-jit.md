---
title: 简单聊聊 Python 3.13 的 JIT 方案
type: tags
date: 2024-01-04 02:30:00
tags: [编程,Python,Linux,笔记,水文]
categories: [编程,Python]
toc: true
---

Python 3.13 的 JIT 方案最终确定了，我觉得可以说又新又好。所以深夜水一篇水文，来聊聊这个 JIT 方案

这篇文章可能会有些枯燥，所以如果对此不感兴趣的同学可以直接 x 掉

<!--more-->

## 基础知识

在聊 Python 3.13 具体的实现之前，我们需要来了解下它所采用的 JIT 方案的基础知识

JIT 本身的定义我相信阅读这篇文章的同学已经非常了解了，所以此处不再赘述。JIT 核心分为两大块

1. 代码的 profile，以确定热点路径，尽可能的减少 JIT 的 fallback
2. 汇编代码的生成

本文主要会聊代码的生成部分

在此之前，Python 生态里一个 JIT 的实现，Pyston/Pypy，他们所采取的方案其实是和 LuaJIT 的方式类似，开发者手写汇编来完成代码的特化，然后依赖 DynASM 执行相关的代码

这种方式主要的缺陷在于

1. 手写汇编带来的心智负担
2. 对于平台的兼容性

为了给大家一个直观的感受，我给出一个我之前写过的汇编的例子来作为演示

首先，我需要实现的功能很简单，用 C 来描述应该是这样的

```c
int main(int argc, char *argv[], char * envp[]) {
    if (argv > 0) {
        return execve(args[0], args, envp);
    }
    return 0;
}
```

因为一些尺寸极端敏感的场景，这份 C 代码没有办法直接 link libc，为了尽可能的压缩 binary size，我选择用汇编实现，以下是 X86_64 的 ASM 

```asm
.global _start

.section .text
_start:
    # Setup stack frame
    movq %rsp, %rbp

    # Load argc
    movq (%rbp), %r8       # %r8 now holds argc

    # Load argv
    leaq 8(%rbp), %r9      # %r9 now points to argv[0]

    # Find envp by iterating through argv until NULL is found
    movq %r9, %r10         # %r10 will be used to find envp
find_envp:
    movq (%r10), %rdi      # Load the current pointer in argv
    cmpq $0, %rdi          # Compare it to NULL
    je envp_found          # If NULL, we've found the end of argv
    addq $8, %r10          # Otherwise, move to the next pointer in argv
    jmp find_envp

envp_found:
    addq $8, %r10          # Move one more step to point to the start of envp

    # Allocate space on the stack for the new argv array
    subq $8, %rsp          # Space for NULL termination
    subq %r8, %rsp
    subq %r8, %rsp         # Space for argc pointers (including argv[0])
    movq %rsp, %r11        # %r11 now points to the start of the new argv array

    # Copy argv pointers to the new array
    movq $0, %rcx          # Counter
copy_loop:
    cmpq %rcx, %r8
    je copy_done
    movq (%r9, %rcx, 8), %rdi
    movq %rdi, (%r11, %rcx, 8)
    incq %rcx
    jmp copy_loop

copy_done:
    movq $0, (%r11, %rcx, 8)   # NULL-terminate the new argv array

    # Check if argc > 0
    cmpq $0, %r8
    jle .Lexit

    # Execute execve syscall
    movq $59, %rax          # syscall number for execve
    movq (%r11), %rdi        # filename is argv[0]
    movq %r11, %rsi         # New argv array
    movq %r10, %rdx         # envp
    syscall

.Lexit:
    # Exit the program using the exit syscall
    movq $60, %rax
    xorq %rdi, %rdi
    syscall
```

同时，因为这个功能需要跨平台实现，所以我们需要同时实现 ARM64 的版本，以下是 ARM64 的 ASM

```asm
.global _start

.section .text
_start:
    # Setup stack frame
    mov x29, sp

    # Load argc
    ldr x8, [x29]        # x8 now holds argc

    # Load argv
    add x9, x29, #8      # x9 now points to argv[0]

    # Find envp by iterating through argv until NULL is found
    mov x10, x9          # x10 will be used to find envp
find_envp:
    ldr x19, [x10]       # Load the current pointer in argv
    cbz x19, envp_found  # If NULL, we've found the end of argv
    add x10, x10, #8     # Otherwise, move to the next pointer in argv
    b find_envp

envp_found:
    add x10, x10, #8     # Move one more step to point to the start of envp

    # Allocate space on the stack for the new argv array
    sub sp, sp, #8       # Space for NULL termination
    sub sp, sp, x8, lsl #3
    sub sp, sp, x8, lsl #3      # Space for argc pointers (including argv[0])
    mov x11, sp          # x11 now points to the start of the new argv array

    # Copy argv pointers to the new array
    mov x12, #0          # Counter
copy_loop:
    cmp x12, x8
    b.eq copy_done
    ldr x19, [x9, x12, lsl #3]
    str x19, [x11, x12, lsl #3]
    add x12, x12, #1
    b copy_loop

copy_done:
    mov x19, #0
    str x19, [x11, x12, lsl #3]   # NULL-terminate the new argv array

    # Check if argc > 0
    cmp x8, #0
    b.le .Lexit

    # Execute execve syscall
    mov x8, #221         # syscall number for execve
    ldr x0, [x11]        # filename is argv[0]
    mov x1, x11          # New argv array
    mov x2, x10          # envp
    svc #0

.Lexit:
    # Exit the program using the exit syscall
    mov x8, #93
    mov x0, #0
    svc #0
```

你能发现，X86_64 的寄存器和 ARM 生态完全不一样，这就导致了我们需要为不同的平台写不同的汇编代码，你再考虑下我们需要

1. MIPS
2. RISC-V
3. PowerPC
4. ...

即便 DynASM 已经对跨平台做了一些抽象，但是直接手写汇编所带来的心智负担还是非常大的

所以，我们需要更现代化的方案，这就是今天要聊到 Copy And Patch。其核心在于利用已有编译器生成的汇编代码，然后对其进行 patch，来完成代码的特化

我们一点点来了解这个方案，首先我们从最基础的一个代码入手

假设我们现在有一个最基础的 C 代码

```c
int add(int a, int b) {
    return a + b;
}
```

这个代码没有任何问题，我们可以直接用 gcc 来编译它，然后反汇编，看看它的汇编代码是什么样的

```asm
0000000000000000 <add>:
       0: 55                            pushq   %rbp
       1: 48 89 e5                      movq    %rsp, %rbp
       4: 89 7d fc                      movl    %edi, -0x4(%rbp)
       7: 89 75 f8                      movl    %esi, -0x8(%rbp)
       a: 8b 55 fc                      movl    -0x4(%rbp), %edx
       d: 8b 45 f8                      movl    -0x8(%rbp), %eax
      10: 01 d0                         addl    %edx, %eax
      12: 5d                            popq    %rbp
      13: c3                            retq
```

最基础的汇编代码，没有问题。

那么我们现在有这样一个场景，我们提供两个函数

1. load_left
2. load_right

这个两个函数将用于加载我们左右两个操作数，然后我们的代码变成下面这样

```c
int load_left();
int load_right();
int add() {
    return load_left() + load_right();
}
```

我们开垦一下汇编

```asm
0000000000000000 <add>:
       0: 55                            pushq   %rbp
       1: 48 89 e5                      movq    %rsp, %rbp
       4: 53                            pushq   %rbx
       5: 48 83 ec 08                   subq    $0x8, %rsp
       9: b8 00 00 00 00                movl    $0x0, %eax
       e: e8 00 00 00 00                callq   0x13 <add+0x13>
                000000000000000f:  R_X86_64_PLT32       load_left-0x4
      13: 89 c3                         movl    %eax, %ebx
      15: b8 00 00 00 00                movl    $0x0, %eax
      1a: e8 00 00 00 00                callq   0x1f <add+0x1f>
                000000000000001b:  R_X86_64_PLT32       load_right-0x4
      1f: 01 d8                         addl    %ebx, %eax
      21: 48 8b 5d f8                   movq    -0x8(%rbp), %rbx
      25: c9                            leave
      26: c3                            retq
```

我们关注到，汇编中有这样两行奇怪的东西

```asm
       e: e8 00 00 00 00                callq   0x13 <add+0x13>
                000000000000000f:  R_X86_64_PLT32       load_left-0x4
      1a: e8 00 00 00 00                callq   0x1f <add+0x1f>
                000000000000001b:  R_X86_64_PLT32       load_right-0x4
```

Bingo，熟悉一些基础的程序知识同学应该反应过来了，`e8` 指令（即 x86 下的 callq 指令）后面的 `00 00 00 00` 地址，将会在执行时，被 reloc 成为 `load_left` 和 `load_right` 的地址。

那么可能有些同学已经反应过来了，如果我们有办法将这段汇编代码中的 `e8 00 00 00 00` 替换成 `e8 xx xx xx xx`，那么我们就可以在这里 patch 上我们的代码了。这里是不是可以作为我们 JIT 的入口了呢？

当然，这里有一个问题，`e8` 后面的指令地址应该怎么样确定呢？

这里我们可以注意到，程序中有这样的部分 `000000000000000f:  R_X86_64_PLT32       load_left-0x4`， 这个是一个 ELF 的 Relocation Entry，它的作用是告诉我们，`e8` 后面的地址，应该是 `load_left` 的地址，同时，我们也能知道重定向部分的起始 `0x0f`.

同样的类型还有很多，比如 `R_X86_64_PC32`，`R_X86_64_GOTPCREL` 等等，这些类型的 Relocation Entry 都可以帮助我们定位到我们需要 patch 的地址，以及帮助我们计算偏移

再举个例子

```asm
// 17f: 48 bf 00 00 00 00 00 00 00 00 movabsq $0x0, %rdi
// 0000000000000181:  R_X86_64_64  .rodata.str1.1
// 189: 48 be 00 00 00 00 00 00 00 00 movabsq $0x0, %rsi
// 000000000000018b:  R_X86_64_64  .rodata.str1.1+0x16
```

这里我们可以看到，`48 bf 00 00 00 00 00 00 00 00` 和 `48 be 00 00 00 00 00 00 00 00` 后面都有一个 `R_X86_64_64` 的 Relocation Entry，这个 Relocation Entry 告诉我们，这两个指令后面的地址，应该是 `.rodata.str1.1` 的地址，同时，我们也能知道重定向部分的起始 `0x181` 和 `0x18b`，这样我们就可以计算出偏移，然后 patch 上我们的代码了

那么这就是整个 copy and patch 的大概过程，我们可以利用编译器生成的汇编代码，然后通过 Relocation Entry 来定位我们需要 patch 的地址，然后 patch 上我们的代码。最终尽可能的简化我们的心智负担

## Python 3.13 的 JIT

Python 3.13 目前的 JIT 方案已经确定下来了，它的核心就是 Copy And Patch，现在我们整体来看一下

首先，Python 有一个 `Python/executor_cases.h` 文件，囊括了我们所有的字节码和对应的操作

比如

```c
        case _BINARY_OP_ADD_INT: {
            PyObject *right;
            PyObject *left;
            PyObject *res;
            right = stack_pointer[-1];
            left = stack_pointer[-2];
            STAT_INC(BINARY_OP, hit);
            res = _PyLong_Add((PyLongObject *)left, (PyLongObject *)right);
            _Py_DECREF_SPECIALIZED(right, (destructor)PyObject_Free);
            _Py_DECREF_SPECIALIZED(left, (destructor)PyObject_Free);
            if (res == NULL) goto pop_2_error_tier_two;
            stack_pointer[-2] = res;
            stack_pointer += -1;
            break;
        }
```

然后我们新增加了一个 `tools/template.c` 文件，

```c
#include "Python.h"

#include "pycore_call.h"
#include "pycore_ceval.h"
#include "pycore_dict.h"
#include "pycore_emscripten_signal.h"
#include "pycore_intrinsics.h"
#include "pycore_jit.h"
#include "pycore_long.h"
#include "pycore_opcode_metadata.h"
#include "pycore_opcode_utils.h"
#include "pycore_range.h"
#include "pycore_setobject.h"
#include "pycore_sliceobject.h"

#include "ceval_macros.h"

#undef CURRENT_OPARG
#define CURRENT_OPARG() (_oparg)

#undef CURRENT_OPERAND
#define CURRENT_OPERAND() (_operand)

#undef DEOPT_IF
#define DEOPT_IF(COND, INSTNAME) \
    do {                         \
        if ((COND)) {            \
            goto deoptimize;     \
        }                        \
    } while (0)

#undef ENABLE_SPECIALIZATION
#define ENABLE_SPECIALIZATION (0)

#undef GOTO_ERROR
#define GOTO_ERROR(LABEL)        \
    do {                         \
        goto LABEL ## _tier_two; \
    } while (0)

#undef LOAD_IP
#define LOAD_IP(UNUSED) \
    do {                \
    } while (0)

#define PATCH_VALUE(TYPE, NAME, ALIAS)  \
    extern void ALIAS;                  \
    TYPE NAME = (TYPE)(uint64_t)&ALIAS;

#define PATCH_JUMP(ALIAS)                                    \
    extern void ALIAS;                                       \
    __attribute__((musttail))                                \
    return ((jit_func)&ALIAS)(frame, stack_pointer, tstate);

_Py_CODEUNIT *
_JIT_ENTRY(_PyInterpreterFrame *frame, PyObject **stack_pointer, PyThreadState *tstate)
{
    // Locals that the instruction implementations expect to exist:
    PATCH_VALUE(_PyUOpExecutorObject *, current_executor, _JIT_EXECUTOR)
    int oparg;
    int opcode = _JIT_OPCODE;
    _PyUOpInstruction *next_uop;
    // Other stuff we need handy:
    PATCH_VALUE(uint16_t, _oparg, _JIT_OPARG)
    PATCH_VALUE(uint64_t, _operand, _JIT_OPERAND)
    PATCH_VALUE(uint32_t, _target, _JIT_TARGET)
    // The actual instruction definitions (only one will be used):
    if (opcode == _JUMP_TO_TOP) {
        CHECK_EVAL_BREAKER();
        PATCH_JUMP(_JIT_TOP);
    }
    switch (opcode) {
#include "executor_cases.c.h"
        default:
            Py_UNREACHABLE();
    }
    PATCH_JUMP(_JIT_CONTINUE);
    // Labels that the instruction implementations expect to exist:
unbound_local_error_tier_two:
    _PyEval_FormatExcCheckArg(
        tstate, PyExc_UnboundLocalError, UNBOUNDLOCAL_ERROR_MSG,
        PyTuple_GetItem(_PyFrame_GetCode(frame)->co_localsplusnames, oparg));
    goto error_tier_two;
pop_4_error_tier_two:
    STACK_SHRINK(1);
pop_3_error_tier_two:
    STACK_SHRINK(1);
pop_2_error_tier_two:
    STACK_SHRINK(1);
pop_1_error_tier_two:
    STACK_SHRINK(1);
error_tier_two:
    _PyFrame_SetStackPointer(frame, stack_pointer);
    return NULL;
deoptimize:
    _PyFrame_SetStackPointer(frame, stack_pointer);
    return _PyCode_CODE(_PyFrame_GetCode(frame)) + _target;
}
```


其中，_JIT_OPCODE，由编译时传入，作为当前的 opcode，因为这是一个固定值，所以编译器在编译的时候，会 strip 掉其余的分支，只保留当前 opcode 的分支，某种意义上，核心的 switch 部分就编程这样了（以 _BINARY_OP_ADD_INT 为例）

```c
switch(_BINARY_OP_ADD_INT) {
    case _BINARY_OP_ADD_INT: {
        PyObject *right;
        PyObject *left;
        PyObject *res;
        right = stack_pointer[-1];
        left = stack_pointer[-2];
        STAT_INC(BINARY_OP, hit);
        res = _PyLong_Add((PyLongObject *)left, (PyLongObject *)right);
        _Py_DECREF_SPECIALIZED(right, (destructor)PyObject_Free);
        _Py_DECREF_SPECIALIZED(left, (destructor)PyObject_Free);
        if (res == NULL) goto pop_2_error_tier_two;
        stack_pointer[-2] = res;
        stack_pointer += -1;
        break;
    }
    default:
        Py_UNREACHABLE();
}
```

我们最终能得到这样的汇编

```asm
// 0: 55                            pushq   %rbp
// 1: 41 57                         pushq   %r15
// 3: 41 56                         pushq   %r14
// 5: 41 55                         pushq   %r13
// 7: 41 54                         pushq   %r12
// 9: 53                            pushq   %rbx
// a: 48 83 ec 18                   subq    $0x18, %rsp
// e: 48 89 54 24 10                movq    %rdx, 0x10(%rsp)
// 13: 49 89 f7                      movq    %rsi, %r15
// 16: 48 89 7c 24 08                movq    %rdi, 0x8(%rsp)
// 1b: 4c 8b 66 f0                   movq    -0x10(%rsi), %r12
// 1f: 48 8b 6e f8                   movq    -0x8(%rsi), %rbp
// 23: 49 be 00 00 00 00 00 00 00 00 movabsq $0x0, %r14
// 0000000000000025:  R_X86_64_64  _Py_stats
// 2d: 49 8b 06                      movq    (%r14), %rax
// 30: 48 85 c0                      testq   %rax, %rax
// 33: 74 07                         je      0x3c <_JIT_ENTRY+0x3c>
// 35: 48 ff 80 88 a4 01 00          incq    0x1a488(%rax)
// 3c: 48 b8 00 00 00 00 00 00 00 00 movabsq $0x0, %rax
// 000000000000003e:  R_X86_64_64  _PyLong_Add
// 46: 4c 89 e7                      movq    %r12, %rdi
// 49: 48 89 ee                      movq    %rbp, %rsi
// 4c: ff d0                         callq   *%rax
// 4e: 49 89 c5                      movq    %rax, %r13
// 51: f6 45 03 80                   testb   $-0x80, 0x3(%rbp)
// 55: 48 b9 00 00 00 00 00 00 00 00 movabsq $0x0, %rcx
// 0000000000000057:  R_X86_64_64  PyInterpreterState_Get
// 5f: 75 24                         jne     0x85 <_JIT_ENTRY+0x85>
// 61: 49 8b 06                      movq    (%r14), %rax
// 64: 48 85 c0                      testq   %rax, %rax
// 67: 74 07                         je      0x70 <_JIT_ENTRY+0x70>
// 69: 48 ff 80 78 58 09 00          incq    0x95878(%rax)
// 70: 48 89 cb                      movq    %rcx, %rbx
// 73: ff d1                         callq   *%rcx
// 75: 48 89 d9                      movq    %rbx, %rcx
// 78: 48 ff 88 c8 15 04 00          decq    0x415c8(%rax)
// 7f: 48 ff 4d 00                   decq    (%rbp)
// 83: 74 37                         je      0xbc <_JIT_ENTRY+0xbc>
// 85: 41 f6 44 24 03 80             testb   $-0x80, 0x3(%r12)
// 8b: 75 49                         jne     0xd6 <_JIT_ENTRY+0xd6>
// 8d: 49 8b 06                      movq    (%r14), %rax
// 90: 48 85 c0                      testq   %rax, %rax
// 93: 74 07                         je      0x9c <_JIT_ENTRY+0x9c>
// 95: 48 ff 80 78 58 09 00          incq    0x95878(%rax)
// 9c: ff d1                         callq   *%rcx
// 9e: 48 ff 88 c8 15 04 00          decq    0x415c8(%rax)
// a5: 49 ff 0c 24                   decq    (%r12)
// a9: 75 2b                         jne     0xd6 <_JIT_ENTRY+0xd6>
// ab: 48 b8 00 00 00 00 00 00 00 00 movabsq $0x0, %rax
// 00000000000000ad:  R_X86_64_64  PyObject_Free
// b5: 4c 89 e7                      movq    %r12, %rdi
// b8: ff d0                         callq   *%rax
// ba: eb 1a                         jmp     0xd6 <_JIT_ENTRY+0xd6>
// bc: 48 b8 00 00 00 00 00 00 00 00 movabsq $0x0, %rax
// 00000000000000be:  R_X86_64_64  PyObject_Free
// c6: 48 89 ef                      movq    %rbp, %rdi
// c9: ff d0                         callq   *%rax
// cb: 48 89 d9                      movq    %rbx, %rcx
// ce: 41 f6 44 24 03 80             testb   $-0x80, 0x3(%r12)
// d4: 74 b7                         je      0x8d <_JIT_ENTRY+0x8d>
// d6: 49 8d 47 f0                   leaq    -0x10(%r15), %rax
// da: 4d 85 ed                      testq   %r13, %r13
// dd: 74 2e                         je      0x10d <_JIT_ENTRY+0x10d>
// df: 49 83 c7 f8                   addq    $-0x8, %r15
// e3: 4c 89 28                      movq    %r13, (%rax)
// e6: 48 b8 00 00 00 00 00 00 00 00 movabsq $0x0, %rax
// 00000000000000e8:  R_X86_64_64  _JIT_CONTINUE
// f0: 48 8b 7c 24 08                movq    0x8(%rsp), %rdi
// f5: 4c 89 fe                      movq    %r15, %rsi
// f8: 48 8b 54 24 10                movq    0x10(%rsp), %rdx
// fd: 48 83 c4 18                   addq    $0x18, %rsp
// 101: 5b                            popq    %rbx
// 102: 41 5c                         popq    %r12
// 104: 41 5d                         popq    %r13
// 106: 41 5e                         popq    %r14
// 108: 41 5f                         popq    %r15
// 10a: 5d                            popq    %rbp
// 10b: ff e0                         jmpq    *%rax
// 10d: 48 8b 4c 24 08                movq    0x8(%rsp), %rcx
// 112: 48 29 c8                      subq    %rcx, %rax
// 115: 48 83 c0 b8                   addq    $-0x48, %rax
// 119: 48 c1 e8 03                   shrq    $0x3, %rax
// 11d: 89 41 40                      movl    %eax, 0x40(%rcx)
// 120: 31 c0                         xorl    %eax, %eax
// 122: 48 83 c4 18                   addq    $0x18, %rsp
// 126: 5b                            popq    %rbx
// 127: 41 5c                         popq    %r12
// 129: 41 5d                         popq    %r13
// 12b: 41 5e                         popq    %r14
// 12d: 41 5f                         popq    %r15
// 12f: 5d                            popq    %rbp
// 130: c3                            retq
// 131: 
```

OK，我们在编译器（目前 Python 选用的 LLVM 系列的工具链，编译器为 clang）开了 O3 编译后得到中间文件后，我们利用 `llvm-objdump` 和 `llvm-readobj` 来获取到我们需要的信息（这里其实也是一个非常棒的细节，因为我们要跨很多平台，要处理几种不同的二进制格式，比如 Linux 下 ELF，Windows 下 PE，MacOS 下 Mach-O，所以我们需要一个统一的工具来处理这些二进制格式，而 LLVM 的工具链就是这样的工具）我们能注意到，在上面的代码中，有这样一些重定向条目

```asm
// 0000000000000025:  R_X86_64_64  _Py_stats
// 000000000000003e:  R_X86_64_64  _PyLong_Add
// 0000000000000057:  R_X86_64_64  PyInterpreterState_Get
// 00000000000000ad:  R_X86_64_64  PyObject_Free
// 00000000000000be:  R_X86_64_64  PyObject_Free
// 00000000000000e8:  R_X86_64_64  _JIT_CONTINUE
```

然后我们就可以根据从工具链中获取到的信息，来定位到我们需要 patch 的地址，然后生成一些运行时 patch 的 flag，最终生成这样一份 C 代码

```c
static const unsigned char _BINARY_OP_ADD_INT_code_body[306] = {0x55, 0x41, 0x57, 0x41, 0x56, 0x41, 0x55, 0x41, 0x54, 0x53, 0x48, 0x83, 0xec, 0x18, 0x48, 0x89, 0x54, 0x24, 0x10, 0x49, 0x89, 0xf7, 0x48, 0x89, 0x7c, 0x24, 0x08, 0x4c, 0x8b, 0x66, 0xf0, 0x48, 0x8b, 0x6e, 0xf8, 0x49, 0xbe, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x49, 0x8b, 0x06, 0x48, 0x85, 0xc0, 0x74, 0x07, 0x48, 0xff, 0x80, 0x88, 0xa4, 0x01, 0x00, 0x48, 0xb8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x4c, 0x89, 0xe7, 0x48, 0x89, 0xee, 0xff, 0xd0, 0x49, 0x89, 0xc5, 0xf6, 0x45, 0x03, 0x80, 0x48, 0xb9, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x75, 0x24, 0x49, 0x8b, 0x06, 0x48, 0x85, 0xc0, 0x74, 0x07, 0x48, 0xff, 0x80, 0x78, 0x58, 0x09, 0x00, 0x48, 0x89, 0xcb, 0xff, 0xd1, 0x48, 0x89, 0xd9, 0x48, 0xff, 0x88, 0xc8, 0x15, 0x04, 0x00, 0x48, 0xff, 0x4d, 0x00, 0x74, 0x37, 0x41, 0xf6, 0x44, 0x24, 0x03, 0x80, 0x75, 0x49, 0x49, 0x8b, 0x06, 0x48, 0x85, 0xc0, 0x74, 0x07, 0x48, 0xff, 0x80, 0x78, 0x58, 0x09, 0x00, 0xff, 0xd1, 0x48, 0xff, 0x88, 0xc8, 0x15, 0x04, 0x00, 0x49, 0xff, 0x0c, 0x24, 0x75, 0x2b, 0x48, 0xb8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x4c, 0x89, 0xe7, 0xff, 0xd0, 0xeb, 0x1a, 0x48, 0xb8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x48, 0x89, 0xef, 0xff, 0xd0, 0x48, 0x89, 0xd9, 0x41, 0xf6, 0x44, 0x24, 0x03, 0x80, 0x74, 0xb7, 0x49, 0x8d, 0x47, 0xf0, 0x4d, 0x85, 0xed, 0x74, 0x2e, 0x49, 0x83, 0xc7, 0xf8, 0x4c, 0x89, 0x28, 0x48, 0xb8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x48, 0x8b, 0x7c, 0x24, 0x08, 0x4c, 0x89, 0xfe, 0x48, 0x8b, 0x54, 0x24, 0x10, 0x48, 0x83, 0xc4, 0x18, 0x5b, 0x41, 0x5c, 0x41, 0x5d, 0x41, 0x5e, 0x41, 0x5f, 0x5d, 0xff, 0xe0, 0x48, 0x8b, 0x4c, 0x24, 0x08, 0x48, 0x29, 0xc8, 0x48, 0x83, 0xc0, 0xb8, 0x48, 0xc1, 0xe8, 0x03, 0x89, 0x41, 0x40, 0x31, 0xc0, 0x48, 0x83, 0xc4, 0x18, 0x5b, 0x41, 0x5c, 0x41, 0x5d, 0x41, 0x5e, 0x41, 0x5f, 0x5d, 0xc3};
static const Hole _BINARY_OP_ADD_INT_code_holes[7] = {
    {0x25, HoleKind_R_X86_64_64, HoleValue_ZERO, &_Py_stats, 0x0},
    {0x3e, HoleKind_R_X86_64_64, HoleValue_ZERO, &_PyLong_Add, 0x0},
    {0x57, HoleKind_R_X86_64_64, HoleValue_ZERO, &PyInterpreterState_Get, 0x0},
    {0xad, HoleKind_R_X86_64_64, HoleValue_ZERO, &PyObject_Free, 0x0},
    {0xbe, HoleKind_R_X86_64_64, HoleValue_ZERO, &PyObject_Free, 0x0},
    {0xe8, HoleKind_R_X86_64_64, HoleValue_CONTINUE, NULL, 0x0},
};
```

最终所有指令编译完成后，最终会生成 `jit_stencils.h` 文件，被我们其余 CPython 代码引用，编译进我们的二进制中

然后我们来看下，我们的 JIT 是如何工作的

```c
int
_PyJIT_Compile(_PyUOpExecutorObject *executor)
{
    // Loop once to find the total compiled size:
    size_t code_size = 0;
    size_t data_size = 0;
    for (Py_ssize_t i = 0; i < Py_SIZE(executor); i++) {
        _PyUOpInstruction *instruction = &executor->trace[i];
        const StencilGroup *group = &stencil_groups[instruction->opcode];
        code_size += group->code.body_size;
        data_size += group->data.body_size;
    }
    // Round up to the nearest page (code and data need separate pages):
    size_t page_size = get_page_size();
    assert((page_size & (page_size - 1)) == 0);
    code_size += page_size - (code_size & (page_size - 1));
    data_size += page_size - (data_size & (page_size - 1));
    char *memory = jit_alloc(code_size + data_size);
    if (memory == NULL) {
        goto fail;
    }
    // Loop again to emit the code:
    char *code = memory;
    char *data = memory + code_size;
    for (Py_ssize_t i = 0; i < Py_SIZE(executor); i++) {
        _PyUOpInstruction *instruction = &executor->trace[i];
        const StencilGroup *group = &stencil_groups[instruction->opcode];
        // Think of patches as a dictionary mapping HoleValue to uint64_t:
        uint64_t patches[] = GET_PATCHES();
        patches[HoleValue_CODE] = (uint64_t)code;
        patches[HoleValue_CONTINUE] = (uint64_t)code + group->code.body_size;
        patches[HoleValue_DATA] = (uint64_t)data;
        patches[HoleValue_EXECUTOR] = (uint64_t)executor;
        patches[HoleValue_OPARG] = instruction->oparg;
        patches[HoleValue_OPERAND] = instruction->operand;
        patches[HoleValue_TARGET] = instruction->target;
        patches[HoleValue_TOP] = (uint64_t)memory;
        patches[HoleValue_ZERO] = 0;
        emit(group, patches);
        code += group->code.body_size;
        data += group->data.body_size;
    }
    if (mark_executable(memory, code_size) ||
        mark_readable(memory + code_size, data_size))
    {
        jit_free(memory, code_size + data_size);
        goto fail;
    }
    executor->base.execute = execute;
    executor->jit_code = memory;
    executor->jit_size = code_size + data_size;
    return 1;
fail:
    return PyErr_Occurred() ? -1 : 0;
}
```

这一部分代码看似很复杂，实际上核心代码很简单，利用 `jit_alloc` 生成一块内存，然后利用 `emit` 将我们的汇编代码写入到这块内存中，然后利用 `mark_executable` 和 `mark_readable` 将这块内存标记为可执行和可读，最终将这块内存的地址赋值给我们的 executor，这样我们的 executor 就可以执行我们的 JIT 代码了

然后

```c
patches[HoleValue_CODE] = (uint64_t)code;
patches[HoleValue_CONTINUE] = (uint64_t)code + group->code.body_size;
patches[HoleValue_DATA] = (uint64_t)data;
patches[HoleValue_EXECUTOR] = (uint64_t)executor;
patches[HoleValue_OPARG] = instruction->oparg;
patches[HoleValue_OPERAND] = instruction->operand;
patches[HoleValue_TARGET] = instruction->target;
patches[HoleValue_TOP] = (uint64_t)memory;
patches[HoleValue_ZERO] = 0;
```

这一部分就是将我们提前预置的一些 flag 设定具体的值，以便后续的 patch

然后 patch 核心的部分，就是根据各平台的 LDD 规则来将我们动态的一些地址 patch 到 relocate 的位置

```c
switch (hole->kind) {
    case HoleKind_IMAGE_REL_I386_DIR32:
        // 32-bit absolute address.
        // Check that we're not out of range of 32 unsigned bits:
        assert(value < (1ULL << 32));
        *loc32 = (uint32_t)value;
        return;
    case HoleKind_ARM64_RELOC_UNSIGNED:
    case HoleKind_IMAGE_REL_AMD64_ADDR64:
    case HoleKind_R_AARCH64_ABS64:
    case HoleKind_X86_64_RELOC_UNSIGNED:
    case HoleKind_R_X86_64_64:
        // 64-bit absolute address.
        *loc64 = value;
        return;
    case HoleKind_R_AARCH64_CALL26:
    case HoleKind_R_AARCH64_JUMP26:
        // 28-bit relative branch.
        assert(IS_AARCH64_BRANCH(*loc32));
        value -= (uint64_t)location;
        // Check that we're not out of range of 28 signed bits:
        assert((int64_t)value >= -(1 << 27));
        assert((int64_t)value < (1 << 27));
        // Since instructions are 4-byte aligned, only use 26 bits:
        assert(get_bits(value, 0, 2) == 0);
        set_bits(loc32, 0, 26, value, 2);
        return;
    case HoleKind_R_AARCH64_MOVW_UABS_G0_NC:
        // 16-bit low part of an absolute address.
        assert(IS_AARCH64_MOV(*loc32));
        // Check the implicit shift (this is "part 0 of 3"):
        assert(get_bits(*loc32, 21, 2) == 0);
        set_bits(loc32, 5, 16, value, 0);
        return;
    case HoleKind_R_AARCH64_MOVW_UABS_G1_NC:
        // 16-bit middle-low part of an absolute address.
        assert(IS_AARCH64_MOV(*loc32));
        // Check the implicit shift (this is "part 1 of 3"):
        assert(get_bits(*loc32, 21, 2) == 1);
        set_bits(loc32, 5, 16, value, 16);
        return;
    case HoleKind_R_AARCH64_MOVW_UABS_G2_NC:
        // 16-bit middle-high part of an absolute address.
        assert(IS_AARCH64_MOV(*loc32));
        // Check the implicit shift (this is "part 2 of 3"):
        assert(get_bits(*loc32, 21, 2) == 2);
        set_bits(loc32, 5, 16, value, 32);
        return;
    case HoleKind_R_AARCH64_MOVW_UABS_G3:
        // 16-bit high part of an absolute address.
        assert(IS_AARCH64_MOV(*loc32));
        // Check the implicit shift (this is "part 3 of 3"):
        assert(get_bits(*loc32, 21, 2) == 3);
        set_bits(loc32, 5, 16, value, 48);
        return;
    case HoleKind_ARM64_RELOC_GOT_LOAD_PAGE21:
        // 21-bit count of pages between this page and an absolute address's
        // page... I know, I know, it's weird. Pairs nicely with
        // ARM64_RELOC_GOT_LOAD_PAGEOFF12 (below).
        assert(IS_AARCH64_ADRP(*loc32));
        // Number of pages between this page and the value's page:
        value = (value >> 12) - ((uint64_t)location >> 12);
        // Check that we're not out of range of 21 signed bits:
        assert((int64_t)value >= -(1 << 20));
        assert((int64_t)value < (1 << 20));
        // value[0:2] goes in loc[29:31]:
        set_bits(loc32, 29, 2, value, 0);
        // value[2:21] goes in loc[5:26]:
        set_bits(loc32, 5, 19, value, 2);
        return;
    case HoleKind_ARM64_RELOC_GOT_LOAD_PAGEOFF12:
        // 12-bit low part of an absolute address. Pairs nicely with
        // ARM64_RELOC_GOT_LOAD_PAGE21 (above).
        assert(IS_AARCH64_LDR_OR_STR(*loc32) || IS_AARCH64_ADD_OR_SUB(*loc32));
        // There might be an implicit shift encoded in the instruction:
        uint8_t shift = 0;
        if (IS_AARCH64_LDR_OR_STR(*loc32)) {
            shift = (uint8_t)get_bits(*loc32, 30, 2);
            // If both of these are set, the shift is supposed to be 4.
            // That's pretty weird, and it's never actually been observed...
            assert(get_bits(*loc32, 23, 1) == 0 || get_bits(*loc32, 26, 1) == 0);
        }
        value = get_bits(value, 0, 12);
        assert(get_bits(value, 0, shift) == 0);
        set_bits(loc32, 10, 12, value, shift);
        return;
}
```

整体上的思路就是差不多这样一些，剩下的就是一些 corner case 的处理，本文先不在展开。大家感兴趣的话，我单独开单篇再来聊一些

## 总结

我们能发现 Python 3.13 JIT 方案的一个很大的特点是，尽可能的利用了 LLVM 生态的东西，编译器用 clang，编译参数开 -o3 获取最大的性能，二进制用具用 `llvm-objdump` 和 `llvm-readelf`，这样做相较于其余方案的好处非常非常的明显

1. clang 的编译器优化能力非常强，能够生成非常高效的代码
2. 能够利用 LLVM 生态的工具链，能够更好的处理跨平台的问题
3. 避免了人工维护的困境，大部分的改动也能通过自动化的方式生成与集成，避免低级错误的诞生

所以我说 Python 3.13 的 JIT 方案可谓是又新又好
