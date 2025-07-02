---
title: "Python 3.14 的进一步性能进化: Tail Call Interpreter"
type: tags
date: 2025-07-02 23:49:00
tags: [编程,Linux,Python,笔记,水文]
categories: [编程,Python]
toc: true
swiper_index: 0
---

最近做安全做的我头晕脑胀，来点轻松的换换脑子，让自己放松下

Python 3.14 正式引入了一个新的机制叫作 Tail Call Interpreter（Made by Ken Jin），这无疑又是一个奠定未来基础的重大工作

<!--more-->

## 正文

在聊 Python 3.14 的 Tail Call Interpreter 之前，我们先要来聊 C 语言中最基本的语法 switch-case

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

对于这样的代码我们最终的汇编会是什么样的呢？可能大家第一反应是先 cmp 然后 je ，不等式秒了，我们编译一个版本来看看

对于这样一段代码

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

最终汇编的产物会是这样的

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

我们能看到整体如我们所预期的一样，不断的 cmp 然后不断的 je，然后我们评估一下这里的复杂度呢？哦，时间复杂度 O(n) 秒了。

卧槽，那对于 Python 这样一个超大的 switch case 的结构，岂不是每次都是一个 O(n) ？这不得原地升天？

其实不是，通常来说，编译器会根据数据的类型和规模来用不同的方案处理 switch case 的结构

我们来准备几组例子

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

然后我们反汇编以下，看下结果（这里我只把关键的部分贴出来）

```asm
00000000000011f0 <small_switch>:
    11f0:	83 ff 02             	cmp    $0x2,%edi      # 比较是否为2
    11f3:	74 2b                	je     1220            # 跳转到case 2
    11f5:	83 ff 03             	cmp    $0x3,%edi      # 比较是否为3
    11f8:	74 16                	je     1210            # 跳转到case 3
    11fa:	83 ff 01             	cmp    $0x1,%edi      # 比较是否为1
    11fd:	75 31                	jne    1230            # 不是则跳转到default

0000000000001240 <dense_switch>:
    1240:	83 ef 0a             	sub    $0xa,%edi      # 减去10 (最小case值)
    1243:	83 ff 07             	cmp    $0x7,%edi      # 比较范围 (17-10=7)
    1246:	0f 87 90 00 00 00    	ja     12dc           # 超出范围跳转default
    124c:	48 8d 15 15 0f 00 00 	lea    0xf15(%rip),%rdx # 加载跳转表地址
    1253:	48 63 04 ba          	movslq (%rdx,%rdi,4),%rax # 获取偏移量
    1257:	48 01 d0             	add    %rdx,%rax      # 计算目标地址
    125a:	ff e0                	jmp    *%rax          # 间接跳转

00000000000012f0 <sparse_switch>:
    12f0:	81 ff e8 03 00 00    	cmp    $0x3e8,%edi    # 比较1000
    12f6:	74 40                	je     1338           # 等于则跳转
    12f8:	7f 16                	jg     1310           # 大于1000则继续检查
    12fa:	83 ff 01             	cmp    $0x1,%edi      # 小于1000，检查1
    12fd:	74 49                	je     1348           
    12ff:	83 ff 64             	cmp    $0x64,%edi     # 检查100
    1302:	75 24                	jne    1328           # 都不是则default
    ...
    1310:	81 ff 10 27 00 00    	cmp    $0x2710,%edi   # 检查10000

0000000000001360 <large_dense_switch>:
    1360:	83 ff 14             	cmp    $0x14,%edi     # 检查是否≤20
    1363:	0f 87 53 01 00 00    	ja     14bc           # 超出范围
    1369:	48 8d 15 18 0e 00 00 	lea    0xe18(%rip),%rdx # 跳转表地址
    1372:	48 63 04 ba          	movslq (%rdx,%rdi,4),%rax # 直接索引
    1376:	48 01 d0             	add    %rdx,%rax
    1379:	ff e0                	jmp    *%rax

00000000000014d0 <mixed_switch>:
    14d0:	83 ff 32             	cmp    $0x32,%edi     # 比较50
    14d3:	74 7b                	je     1550
    14d5:	7f 29                	jg     1500           # >50的情况
    14d7:	83 ff 02             	cmp    $0x2,%edi      # ≤50，检查小值
    14da:	74 64                	je     1540
    14dc:	83 ff 03             	cmp    $0x3,%edi
    ...
    1500:	83 ff 65             	cmp    $0x65,%edi     # >50，检查100,101,102
    1503:	74 5b                	je     1560

0000000000001580 <char_switch>:
    1580:	83 ef 61             	sub    $0x61,%edi     # 减去'a'的ASCII值
    1583:	40 80 ff 04          	cmp    $0x4,%dil      # 检查是否≤4 (a-e)
    1587:	77 63                	ja     15ec
    1589:	48 8d 15 4c 0c 00 00 	lea    0xc4c(%rip),%rdx
    1590:	40 0f b6 ff          	movzbl %dil,%edi      # 零扩展到32位
    1594:	48 63 04 ba          	movslq (%rdx,%rdi,4),%rax

```

我们这里能看到编译器根据数据的不同类型来处理了 switch case 的结构，这里我用一个表格总结一下

| Switch类型 | Case数量 | 分布特点 | 编译器策略 | 时间复杂度 |
|------------|----------|----------|------------|------------|
| small_switch | 3个 | 连续(1,2,3) | 线性比较 | O(n) |
| dense_switch | 8个 | 连续(10-17) | 偏移跳转表 | O(1) |
| sparse_switch | 4个 | 稀疏(1,100,1000,10000) | 二分查找 | O(log n) |
| large_dense_switch | 20个 | 连续(1-20) | 标准跳转表 | O(1) |
| mixed_switch | 7个 | 部分连续 | 嵌套比较 | O(log n) |
| char_switch | 5个 | 连续('a'-'e') | 字符偏移表 | O(1) |

OK，这里我们发现，Switch-case 最终的实现因为数据类型的不一样，会导致我们最终的代码存在一个不可预测性。那么我们有没有办法来优化这个问题呢？答案是有的。

我们来看下面一段代码

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

我们能看到这里核心的一个操作是将我们 Switch-cased 的每个 case 都变成了一个标签，然后我们通过一个 jump_table 来直接跳转到对应的标签上, 我们来看一下最关键位置的汇编

```asm
    11d3:	48 8d 05 c6 2b 00 00 	lea    0x2bc6(%rip),%rax        # 3da0 <jump_table.0>
    11da:	ff 24 d8             	jmp    *(%rax,%rbx,8)
```

这里我们可以总结出来使用 Computed Goto 相较于传统的 switch-case 有以下几点优势

1. 减少分支预测 fallback 的代价
2. 指令缓存局部性上更优
3. 减少了 cmp 指令的数量和开销

那么具体能有多快呢？可以参见 CPython 引入的 Computed Goto 的一个测试结果，大概是整体提升了15% 左右

那么 Computed Goto 的方式就是完美的吗？其实也不是，目前 CPython 的解释器 ceval.c 也是目前最大的一个 switch case 中存在几个典型问题

1. Computed Goto 作为 clang 和 gcc 特化的功能，那么其余平台受益的可能性较小
2. 目前 Computed Goto 其实并不成熟，在同一个编译器不同的版本可能会有不同的问题
3. 超大型的 switch case 会导致编译器对于 switch case 的优化不够好
4. 我们无法使用 perf 精确的去对我们整个过程中 per opcode 的开销进行定量分析，这在于让 Python 变得更快的大背景下将会是一个很大的问题

1，3，4 都很好理解，我们来看一下2的一个例子（感谢 Ken Jin 提供的例子）

在 GCC 11 的时候，switch-case 某个部分会正常的代码

```asm
    738f: movq	%r13, %r15
    7392: movzbl	%ah, %ebx
    7395: movzbl	%al, %eax
    7398: movq	(,%rax,8), %rax
    73a0: movl	%ebx, -0x248(%rbp)
    73a6: jmpq	*%rax
```

而在 GCC 13-15Beta 的时候，则会产生这样的代码

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

我们能发现，额外的寄存器被引入了。体系结构 101，额外的寄存器意味着额外的开销。寄存器是很贵的！

那么我们有没有办法来迭代上面的超大的 Switch case 呢？估计有同学在想，既然上面的 switch case 超级大，那么我们将其拆分为多个小的函数
这样编译器可以有足够的上下文来优化，同时我们的 perf 也可以精确的去分析每个函数的开销，岂不美哉？

但是又有同学反对了，函数调用会触发 call 的指令，会带来额外的寄存器入栈和出栈的开销，这样会不会又变慢了呢？

那么能不能优化一下呢？答案是可以的，很多同学可能会想到了，tail call

假设我们有这样一段代码

```c
__attribute__((noinline)) void g(int x) {
    printf("Value: %d\n", x);
};
void f(int x) {
    return g(x);
}
```

我们能看到这样一段汇编

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

其中 `call   1140 <g>` 指令非常显眼。这也是函数调用本身的开销的一个重要来源

在现在编译器中，存在一种特殊的优化叫作尾递归，即当函数的最后一步是调用另一个函数时，编译器可以优化掉这个调用的开销

我们来测试一下

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

我们来看下相关汇编

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

我们能看到，`f` 函数的最后一步是 `jmp 1140 <g>`，而不是 `call 1140 <g>`，这就意味着我们在调用 `g` 函数的时候不会有额外的寄存器分配等传统 call 指令带来的开销。

可能有同学回过味来了，那么这里在做尾递归处理后，感觉完全可以当作一种高性能 Goto 来看嘛。

Bingo，这里其实思路也是差不多这样的，在77年的一篇论文《Debunking the 'Expensive Procedure Call' Myth, or, Procedure Call Implementations Considered Harmful, or, Lambda: The Ultimate GOTO》就提到了，高效的过程调用可以和 Goto 性能相近，而在实现上会更简洁。

在 Python 3.14 中，Tail Call Interpreter 的实现就是基于这个思路的。

我们能看到我们对于 opcode 进行 dispatch 的宏进行了尾递归的处理

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

那么在保证我们基线性能和 Compute GOTO 甚至更优一点的同时，我们可以得到如下的一些好处

1. 更广泛的平台支持
2. 将 case 拆分后，编译器更不容易犯错，整体的性能的可预测性更强
3. happy perf
4. 以及我可以用 eBPF 之类的工具做更多的骚操作（

## 总结

这篇文章差不多就是这样，虽然说是只介绍 Python 3.14 的 Tail Call Interpreter，但是还是完整的介绍了一些整个的一个演进思路

这也带给我一个启发，很多时候，可预测性真的是非常重要的一个特性。

这算是 3.14 中和 remote debug 一起并列为我最喜欢的两个feature，可观测性万岁！
