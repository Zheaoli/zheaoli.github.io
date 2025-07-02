---
title: "Further Performance Evolution in Python 3.14: Tail Call Interpreter"
type: tags
date: 2025-07-02 23:49:00
tags: [Programming, Linux, Python, Notes, Random]
categories: [Programming, Python]
toc: true
---

I've been overwhelmed by security work lately, so let me switch to something lighter to relax my mind.

Python 3.14 has officially introduced a new mechanism called Tail Call Interpreter (Made by Ken Jin), which is undoubtedly another major milestone that lays the foundation for the future.

<!--more-->

## Main Content

Before discussing Python 3.14's Tail Call Interpreter, we need to talk about the most basic syntax in C - switch-case.

```c
switch (x) {
    case 1:
        // do something
        break;
    case 2:
        // do something else
        break;
    default:
        // do default thing
}
```

What would the final assembly look like for such code? Most people's first reaction might be to use `cmp` followed by `je`, and if it doesn't match, continue. Let's compile a version to see.

For this code:

```c
void small_switch(int x) {
    switch(x) {
        case 1: printf("One\n"); break;
        case 2: printf("Two\n"); break;
        case 3: printf("Three\n"); break;
        default: printf("Other\n"); break;
    }
}
```

The final assembly output would be:

```asm  
00000000000011f0 <small_switch>:
    11f0:	83 ff 02             	cmp    $0x2,%edi
    11f3:	74 2b                	je     1220 <small_switch+0x30>
    11f5:	83 ff 03             	cmp    $0x3,%edi
    11f8:	74 16                	je     1210 <small_switch+0x20>
    11fa:	83 ff 01             	cmp    $0x1,%edi
    11fd:	75 31                	jne    1230 <small_switch+0x40>
    11ff:	48 8d 3d fe 0d 00 00 	lea    0xdfe(%rip),%rdi        # 2004 <_IO_stdin_used+0x4>
    1206:	e9 25 fe ff ff       	jmp    1030 <puts@plt>
    120b:	0f 1f 44 00 00       	nopl   0x0(%rax,%rax,1)
    1210:	48 8d 3d f5 0d 00 00 	lea    0xdf5(%rip),%rdi        # 200c <_IO_stdin_used+0xc>
    1217:	e9 14 fe ff ff       	jmp    1030 <puts@plt>
    121c:	0f 1f 40 00          	nopl   0x0(%rax)
    1220:	48 8d 3d e1 0d 00 00 	lea    0xde1(%rip),%rdi        # 2008 <_IO_stdin_used+0x8>
    1227:	e9 04 fe ff ff       	jmp    1030 <puts@plt>
    122c:	0f 1f 40 00          	nopl   0x0(%rax)
    1230:	48 8d 3d db 0d 00 00 	lea    0xddb(%rip),%rdi        # 2012 <_IO_stdin_used+0x12>
    1237:	e9 f4 fd ff ff       	jmp    1030 <puts@plt>
    123c:	0f 1f 40 00          	nopl   0x0(%rax)
```

We can see that overall it's as we expected - continuous `cmp` followed by continuous `je`. Now let's evaluate the complexity here? Oh, time complexity O(n), that's straightforward.

Damn, for Python with such a huge switch case structure, wouldn't that be O(n) every time? Wouldn't that be a performance disaster?

Actually, no. Usually, compilers use different strategies to handle switch case structures based on data type and scale.

Let's prepare several examples:

```c
void small_switch(int x) {
    switch(x) {
        case 1: printf("One\n"); break;
        case 2: printf("Two\n"); break;
        case 3: printf("Three\n"); break;
        default: printf("Other\n"); break;
    }
}

void dense_switch(int x) {
    switch(x) {
        case 10: printf("Ten\n"); break;
        case 11: printf("Eleven\n"); break;
        case 12: printf("Twelve\n"); break;
        case 13: printf("Thirteen\n"); break;
        case 14: printf("Fourteen\n"); break;
        case 15: printf("Fifteen\n"); break;
        case 16: printf("Sixteen\n"); break;
        case 17: printf("Seventeen\n"); break;
        default: printf("Other\n"); break;
    }
}

void sparse_switch(int x) {
    switch(x) {
        case 1: printf("One\n"); break;
        case 100: printf("Hundred\n"); break;
        case 1000: printf("Thousand\n"); break;
        case 10000: printf("Ten thousand\n"); break;
        default: printf("Other\n"); break;
    }
}

void large_dense_switch(int x) {
    switch(x) {
        case 1: printf("Case 1\n"); break;
        case 2: printf("Case 2\n"); break;
        case 3: printf("Case 3\n"); break;
        case 4: printf("Case 4\n"); break;
        case 5: printf("Case 5\n"); break;
        case 6: printf("Case 6\n"); break;
        case 7: printf("Case 7\n"); break;
        case 8: printf("Case 8\n"); break;
        case 9: printf("Case 9\n"); break;
        case 10: printf("Case 10\n"); break;
        case 11: printf("Case 11\n"); break;
        case 12: printf("Case 12\n"); break;
        case 13: printf("Case 13\n"); break;
        case 14: printf("Case 14\n"); break;
        case 15: printf("Case 15\n"); break;
        case 16: printf("Case 16\n"); break;
        case 17: printf("Case 17\n"); break;
        case 18: printf("Case 18\n"); break;
        case 19: printf("Case 19\n"); break;
        case 20: printf("Case 20\n"); break;
        default: printf("Other\n"); break;
    }
}

void mixed_switch(int x) {
    switch(x) {
        case 1: printf("Case 1\n"); break;
        case 2: printf("Case 2\n"); break;
        case 3: printf("Case 3\n"); break;
        
        case 50: printf("Case 50\n"); break;
        
        case 100: printf("Case 100\n"); break;
        case 101: printf("Case 101\n"); break;
        case 102: printf("Case 102\n"); break;
        
        default: printf("Other\n"); break;
    }
}

void char_switch(char c) {
    switch(c) {
        case 'a': printf("Letter a\n"); break;
        case 'b': printf("Letter b\n"); break;
        case 'c': printf("Letter c\n"); break;
        case 'd': printf("Letter d\n"); break;
        case 'e': printf("Letter e\n"); break;
        default: printf("Other char\n"); break;
    }
}
```

Then we disassemble and look at the results (I'll only paste the key parts here):

```asm
00000000000011f0 <small_switch>:
    11f0:	83 ff 02             	cmp    $0x2,%edi      # Compare if it's 2
    11f3:	74 2b                	je     1220            # Jump to case 2
    11f5:	83 ff 03             	cmp    $0x3,%edi      # Compare if it's 3
    11f8:	74 16                	je     1210            # Jump to case 3
    11fa:	83 ff 01             	cmp    $0x1,%edi      # Compare if it's 1
    11fd:	75 31                	jne    1230            # If not, jump to default

0000000000001240 <dense_switch>:
    1240:	83 ef 0a             	sub    $0xa,%edi      # Subtract 10 (minimum case value)
    1243:	83 ff 07             	cmp    $0x7,%edi      # Compare range (17-10=7)
    1246:	0f 87 90 00 00 00    	ja     12dc           # Out of range, jump to default
    124c:	48 8d 15 15 0f 00 00 	lea    0xf15(%rip),%rdx # Load jump table address
    1253:	48 63 04 ba          	movslq (%rdx,%rdi,4),%rax # Get offset
    1257:	48 01 d0             	add    %rdx,%rax      # Calculate target address
    125a:	ff e0                	jmp    *%rax          # Indirect jump

00000000000012f0 <sparse_switch>:
    12f0:	81 ff e8 03 00 00    	cmp    $0x3e8,%edi    # Compare 1000
    12f6:	74 40                	je     1338           # If equal, jump
    12f8:	7f 16                	jg     1310           # If greater than 1000, continue checking
    12fa:	83 ff 01             	cmp    $0x1,%edi      # Less than 1000, check 1
    12fd:	74 49                	je     1348           
    12ff:	83 ff 64             	cmp    $0x64,%edi     # Check 100
    1302:	75 24                	jne    1328           # If none match, default
    ...
    1310:	81 ff 10 27 00 00    	cmp    $0x2710,%edi   # Check 10000

0000000000001360 <large_dense_switch>:
    1360:	83 ff 14             	cmp    $0x14,%edi     # Check if ≤20
    1363:	0f 87 53 01 00 00    	ja     14bc           # Out of range
    1369:	48 8d 15 18 0e 00 00 	lea    0xe18(%rip),%rdx # Jump table address
    1372:	48 63 04 ba          	movslq (%rdx,%rdi,4),%rax # Direct indexing
    1376:	48 01 d0             	add    %rdx,%rax
    1379:	ff e0                	jmp    *%rax

00000000000014d0 <mixed_switch>:
    14d0:	83 ff 32             	cmp    $0x32,%edi     # Compare 50
    14d3:	74 7b                	je     1550
    14d5:	7f 29                	jg     1500           # >50 case
    14d7:	83 ff 02             	cmp    $0x2,%edi      # ≤50, check small values
    14da:	74 64                	je     1540
    14dc:	83 ff 03             	cmp    $0x3,%edi
    ...
    1500:	83 ff 65             	cmp    $0x65,%edi     # >50, check 100,101,102
    1503:	74 5b                	je     1560

0000000000001580 <char_switch>:
    1580:	83 ef 61             	sub    $0x61,%edi     # Subtract ASCII value of 'a'
    1583:	40 80 ff 04          	cmp    $0x4,%dil      # Check if ≤4 (a-e)
    1587:	77 63                	ja     15ec
    1589:	48 8d 15 4c 0c 00 00 	lea    0xc4c(%rip),%rdx
    1590:	40 0f b6 ff          	movzbl %dil,%edi      # Zero-extend to 32 bit
    1594:	48 63 04 ba          	movslq (%rdx,%rdi,4),%rax
```

Here we can see that the compiler handles switch case structures differently based on different data types. Let me summarize this with a table:

| Switch Type | Case Count | Distribution | Compiler Strategy | Time Complexity |
|-------------|------------|--------------|-------------------|-----------------|
| small_switch | 3 | Consecutive(1,2,3) | Linear comparison | O(n) |
| dense_switch | 8 | Consecutive(10-17) | Offset jump table | O(1) |
| sparse_switch | 4 | Sparse(1,100,1000,10000) | Binary search | O(log n) |
| large_dense_switch | 20 | Consecutive(1-20) | Standard jump table | O(1) |
| mixed_switch | 7 | Partially consecutive | Nested comparison | O(log n) |
| char_switch | 5 | Consecutive('a'-'e') | Character offset table | O(1) |

OK, here we find that the final implementation of switch-case varies depending on data types, leading to unpredictability in our final code. So do we have ways to optimize this problem? The answer is yes.

Let's look at the following code:

```c
#include <stdio.h>

void basic_computed_goto(int operation) {
    static void* jump_table[] = {
        &&op_add,   
        &&op_sub,   
        &&op_mul,   
        &&op_div,   
        &&op_mod,   
        &&op_default
    };
    
    int a = 10, b = 3;
    int result;
    
    if (operation < 0 || operation > 4) {
        operation = 5;
    }
    
    printf("Operation %d: a=%d, b=%d -> ", operation, a, b);
    
    goto *jump_table[operation];
    
op_add:
    result = a + b;
    printf("ADD: %d\n", result);
    return;
    
op_sub:
    result = a - b;
    printf("SUB: %d\n", result);
    return;
    
op_mul:
    result = a * b;
    printf("MUL: %d\n", result);
    return;
    
op_div:
    if (b != 0) {
        result = a / b;
        printf("DIV: %d\n", result);
    } else {
        printf("DIV: Error (division by zero)\n");
    }
    return;
    
op_mod:
    if (b != 0) {
        result = a % b;
        printf("MOD: %d\n", result);
    } else {
        printf("MOD: Error (division by zero)\n");
    }
    return;
    
op_default:
    printf("Unknown operation\n");
    return;
}
```

We can see that the core operation here is to turn each case of our switch-case into a label, then we use a jump_table to directly jump to the corresponding label. Let's look at the assembly of the most critical part:

```asm
    11d3:	48 8d 05 c6 2b 00 00 	lea    0x2bc6(%rip),%rax        # 3da0 <jump_table.0>
    11da:	ff 24 d8             	jmp    *(%rax,%rbx,8)
```

Here we can summarize that using Computed Goto compared to traditional switch-case has the following advantages:

1. Reduces the cost of branch prediction fallback
2. Better instruction cache locality
3. Reduces the number and overhead of cmp instructions

So how much faster can it be? You can refer to the test results of Computed Goto introduced in CPython, which showed an overall improvement of about 15%.

So is the Computed Goto approach perfect? Actually, no. Currently, CPython's interpreter ceval.c, which is also currently the largest switch case, has several typical problems:

1. Computed Goto as a specialized feature of clang and gcc, other platforms have limited benefits
2. Currently Computed Goto is not mature, different versions of the same compiler may have different issues
3. Extremely large switch cases cause compilers to not optimize switch cases well enough
4. We cannot use perf to precisely perform quantitative analysis of per-opcode overhead in our entire process, which will be a big problem in the context of making Python faster

Points 1, 3, and 4 are easy to understand. Let's look at an example of point 2 (thanks to Ken Jin for providing the example).

In GCC 11, switch-case would generate normal code in certain parts:

```asm
    738f: movq	%r13, %r15
    7392: movzbl	%ah, %ebx
    7395: movzbl	%al, %eax
    7398: movq	(,%rax,8), %rax
    73a0: movl	%ebx, -0x248(%rbp)
    73a6: jmpq	*%rax
```

While in GCC 13-15Beta, it would generate code like this:

```asm
    747a: movzbl	%ah, %ebx
    747d: movzbl	%al, %eax
    7480: movl	%ebx, -0x248(%rbp)
    7486: movq	(,%rax,8), %rax
    748e: jmp	0x72a0 <_PyEval_EvalFrameDefault+0x970>

    72a0: movq	%r15, %xmm0
    72a5: movq	%r13, %xmm3
    72aa: movq	%r15, %rbx
    72ad: punpcklqdq	%xmm3, %xmm0
    72b1: movhlps	%xmm0, %xmm2
    72b4: movq	%xmm2, %r10
    72b9: movq	%r10, %r11
    72bc: jmpq	*%rax
```

We can see that additional registers were introduced. Computer Architecture 101: additional registers mean additional overhead. Registers are expensive!

So do we have ways to iterate on the extremely large switch case above? Some students might be thinking, since the switch case above is extremely large, why don't we split it into multiple small functions so that the compiler can have enough context to optimize, and our perf can also precisely analyze the overhead of each function. Wouldn't that be great?

But other students object: function calls trigger call instructions, which bring additional overhead of register push and pop operations. Won't this make it slower again?

So can we optimize this? The answer is yes. Many students might have thought of it - tail call.

Suppose we have this code:

```c
__attribute__((noinline)) void g(int x) {
    printf("Value: %d\n", x);
};
void f(int x) {
    return g(x);
}
```

We can see this assembly:

```asm
0000000000001140 <g>:
    1140:	55                   	push   %rbp
    1141:	48 89 e5             	mov    %rsp,%rbp
    1144:	48 83 ec 10          	sub    $0x10,%rsp
    1148:	89 7d fc             	mov    %edi,-0x4(%rbp)
    114b:	8b 75 fc             	mov    -0x4(%rbp),%esi
    114e:	48 8d 3d af 0e 00 00 	lea    0xeaf(%rip),%rdi        # 2004 <_IO_stdin_used+0x4>
    1155:	b0 00                	mov    $0x0,%al
    1157:	e8 d4 fe ff ff       	call   1030 <printf@plt>
    115c:	48 83 c4 10          	add    $0x10,%rsp
    1160:	5d                   	pop    %rbp
    1161:	c3                   	ret
    1162:	66 66 66 66 66 2e 0f 	data16 data16 data16 data16 cs nopw 0x0(%rax,%rax,1)
    1169:	1f 84 00 00 00 00 00 

0000000000001170 <f>:
    1170:	55                   	push   %rbp
    1171:	48 89 e5             	mov    %rsp,%rbp
    1174:	48 83 ec 10          	sub    $0x10,%rsp
    1178:	89 7d fc             	mov    %edi,-0x4(%rbp)
    117b:	8b 7d fc             	mov    -0x4(%rbp),%edi
    117e:	e8 bd ff ff ff       	call   1140 <g>
    1183:	48 83 c4 10          	add    $0x10,%rsp
    1187:	5d                   	pop    %rbp
    1188:	c3                   	ret
    1189:	0f 1f 80 00 00 00 00 	nopl   0x0(%rax)
```

The `call   1140 <g>` instruction is very prominent. This is also an important source of function call overhead.

In modern compilers, there's a special optimization called tail recursion, where when the last step of a function is calling another function, the compiler can optimize away the overhead of this call.

Let's test this:

```c
#include <stdio.h>
__attribute__((preserve_none)) void g(int x);
__attribute__((noinline, preserve_none)) void g(int x){
    printf("Value: %d\n", x);
}

__attribute__((preserve_none)) void f(int x) {
    [[clang::musttail]] return g(x);
}

int main() {
    f(42);
    return 0;
}
```

Let's look at the related assembly:

```asm
0000000000001140 <g>:
    1140:	55                   	push   %rbp
    1141:	48 89 e5             	mov    %rsp,%rbp
    1144:	48 83 ec 10          	sub    $0x10,%rsp
    1148:	44 89 65 fc          	mov    %r12d,-0x4(%rbp)
    114c:	8b 75 fc             	mov    -0x4(%rbp),%esi
    114f:	48 8d 3d ae 0e 00 00 	lea    0xeae(%rip),%rdi        # 2004 <_IO_stdin_used+0x4>
    1156:	31 c0                	xor    %eax,%eax
    1158:	e8 d3 fe ff ff       	call   1030 <printf@plt>
    115d:	48 83 c4 10          	add    $0x10,%rsp
    1161:	5d                   	pop    %rbp
    1162:	c3                   	ret
    1163:	66 66 66 66 2e 0f 1f 	data16 data16 data16 cs nopw 0x0(%rax,%rax,1)
    116a:	84 00 00 00 00 00 

0000000000001170 <f>:
    1170:	55                   	push   %rbp
    1171:	48 89 e5             	mov    %rsp,%rbp
    1174:	44 89 65 fc          	mov    %r12d,-0x4(%rbp)
    1178:	44 8b 65 fc          	mov    -0x4(%rbp),%r12d
    117c:	5d                   	pop    %rbp
    117d:	e9 be ff ff ff       	jmp    1140 <g>
    1182:	66 66 66 66 66 2e 0f 	data16 data16 data16 data16 cs nopw 0x0(%rax,%rax,1)
    1189:	1f 84 00 00 00 00 00 
```

We can see that the last step of function `f` is `jmp 1140 <g>`, not `call 1140 <g>`. This means when we call function `g`, we won't have additional overhead like register allocation that traditional call instructions bring.

Some students might have realized that after tail recursion processing, this can completely be viewed as a high-performance Goto.

Bingo, the idea here is similar. A 1977 paper "Debunking the 'Expensive Procedure Call' Myth, or, Procedure Call Implementations Considered Harmful, or, Lambda: The Ultimate GOTO" mentioned that efficient procedure calls can have performance close to Goto, while being more concise in implementation.

In Python 3.14, the implementation of Tail Call Interpreter is based on this idea.

We can see that we've applied tail recursion processing to the macro that dispatches opcodes:

```c
#   define Py_MUSTTAIL [[clang::musttail]]
#   define Py_PRESERVE_NONE_CC __attribute__((preserve_none))
    Py_PRESERVE_NONE_CC typedef PyObject* (*py_tail_call_funcptr)(TAIL_CALL_PARAMS);

#   define TARGET(op) Py_PRESERVE_NONE_CC PyObject *_TAIL_CALL_##op(TAIL_CALL_PARAMS)
#   define DISPATCH_GOTO() \
        do { \
            Py_MUSTTAIL return (INSTRUCTION_TABLE[opcode])(TAIL_CALL_ARGS); \
        } while (0)
#   define JUMP_TO_LABEL(name) \
        do { \
            Py_MUSTTAIL return (_TAIL_CALL_##name)(TAIL_CALL_ARGS); \
        } while (0)
#   ifdef Py_STATS
#       define JUMP_TO_PREDICTED(name) \
            do { \
                Py_MUSTTAIL return (_TAIL_CALL_##name)(frame, stack_pointer, tstate, this_instr, oparg, lastopcode); \
            } while (0)
#   else
#       define JUMP_TO_PREDICTED(name) \
            do { \
                Py_MUSTTAIL return (_TAIL_CALL_##name)(frame, stack_pointer, tstate, this_instr, oparg); \
            } while (0)
#   endif
#    define LABEL(name) TARGET(name)
```

So while ensuring our baseline performance is as good as or even better than Computed Goto, we can get the following benefits:

1. Broader platform support
2. After splitting cases, compilers are less likely to make mistakes, and overall performance predictability is stronger
3. Happy perf
4. And I can do more cool stuff with tools like eBPF

## Summary

This article is pretty much it. Although it claims to only introduce Python 3.14's Tail Call Interpreter, it still completely introduces the entire evolution of thinking.

This also gives me an insight: predictability is really a very important characteristic in many cases.

This, along with remote debug, are the two features I like most in 3.14. Long live observability!