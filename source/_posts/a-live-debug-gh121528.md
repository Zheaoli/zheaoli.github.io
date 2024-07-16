---
title: Debug 日志：CPython GH-121528
type: tags
date: 2024-07-17 02:20:00
tags: [编程,CPython,笔记,水文]
categories: [编程,CPython]
toc: true
---

Debug 日志系列第二篇，CPython 的 GH-121528，也是很有趣的调试和讨论过程，写出来希望帮助大家

太长不看的版：Python 3.13 Beta 版本中，因为 PEP 683 的实现+周边的改动，导致低版本下编译的一些扩展无法在 Python 3.13 中运行

<!-- more -->

## 开篇

7月9日的时候，PyO3 社区提出了一个 Bug , 编号为 GH-121528[<sup>1</sup>](#reference1)。这个 Bug 可以做这样的表示

假设我们有一个 C 扩展文件

```c
#include <Python.h>

static PyObject *
foo_bar(PyObject *self, PyObject *args)
{
	Py_INCREF(PyExc_TypeError);
	PyErr_SetString(PyExc_TypeError, "foo");
	return NULL;
}

static PyMethodDef foomethods[] = {
	{"bar", foo_bar, METH_VARARGS, ""},
	{NULL, NULL, 0, NULL},
};

static PyModuleDef foomodule = {
	PyModuleDef_HEAD_INIT,
	.m_name = "foo",
	.m_doc = "foo test module",
	.m_size = -1,
	.m_methods = foomethods,
};

PyMODINIT_FUNC
PyInit_foo(void)
{
	return PyModule_Create(&foomodule);
}
```

然后假设我们有这样的 `setup.py` 文件

```python
from setuptools import setup, Extension

setup(name='foo',
      version='0',
      ext_modules=[
          Extension('foo', ['foo.c'], py_limited_api='cp38'),
      ])
```

OK， 基于 Limited API (aka Stable ABI) 编译，社区发现，如果在 <= 3.11 的版本中编译的扩展，在 Python 3.13 以及最新主分支中加载扩展，那么会出现问题

我们来看下堆栈

```text
Process 10157 stopped
* thread #1, queue = 'com.apple.main-thread', stop reason = hit program assert
    frame #4: 0x000000010034043c python.exe`_PyType_AllocNoTrack.cold.2 [inlined] _PyObject_Init(op=<unavailable>, typeobj=<unavailable>) at pycore_object.h:269:5 [opt]
   266  {
   267      assert(op != NULL);
   268      Py_SET_TYPE(op, typeobj);
-> 269      assert(_PyType_HasFeature(typeobj, Py_TPFLAGS_HEAPTYPE) || _Py_IsImmortal(typeobj));
   270      Py_INCREF(typeobj);
   271      _Py_NewReference(op);
   272  }
Target 0: (python.exe) stopped.
warning: python.exe was compiled with optimization - stepping may behave oddly; variables may not be available.
(lldb) bt
* thread #1, queue = 'com.apple.main-thread', stop reason = hit program assert
    frame #0: 0x0000000190ec75e0 libsystem_kernel.dylib`__pthread_kill + 8
    frame #1: 0x0000000190efff70 libsystem_pthread.dylib`pthread_kill + 288
    frame #2: 0x0000000190e0c908 libsystem_c.dylib`abort + 128
    frame #3: 0x0000000190e0bc1c libsystem_c.dylib`__assert_rtn + 284
  * frame #4: 0x000000010034043c python.exe`_PyType_AllocNoTrack.cold.2 [inlined] _PyObject_Init(op=<unavailable>, typeobj=<unavailable>) at pycore_object.h:269:5 [opt]
    frame #5: 0x000000010034041c python.exe`_PyType_AllocNoTrack.cold.2 at typeobject.c:2224:9 [opt]
    frame #6: 0x00000001001299a8 python.exe`_PyType_AllocNoTrack [inlined] _PyObject_Init(op=0x0000000100b0eba0, typeobj=0x000000010054db80) at pycore_object.h:269:5 [opt]
    frame #7: 0x00000001001299a4 python.exe`_PyType_AllocNoTrack(type=0x000000010054db80, nitems=0) at typeobject.c:2224:9 [opt]
    frame #8: 0x00000001001297bc python.exe`PyType_GenericAlloc(type=0x000000010054db80, nitems=<unavailable>) at typeobject.c:2238:21 [opt]
    frame #9: 0x00000001000a7638 python.exe`BaseException_vectorcall(type_obj=0x000000010054db80, args=0x000000016fdfd500, nargsf=9223372036854775809, kwnames=<unavailable>) at exceptions.c:92:37 [opt]
    frame #10: 0x0000000100093220 python.exe`_PyObject_VectorcallTstate(tstate=0x00000001005e6370, callable=0x000000010054db80, args=0x000000016fdfd500, nargsf=9223372036854775809, kwnames=0x0000000000000000) at pycore_call.h:167:11 [opt]
    frame #11: 0x00000001000942bc python.exe`PyObject_CallOneArg(func=<unavailable>, arg=<unavailable>) at call.c:395:12 [opt]
    frame #12: 0x0000000100214d2c python.exe`_PyErr_CreateException(exception_type=0x000000010054db80, value=<unavailable>) at errors.c:44:15 [opt]
    frame #13: 0x0000000100215160 python.exe`_PyErr_SetObject(tstate=0x00000001005e6370, exception=0x000000010054db80, value=0x0000000100c41530) at errors.c:184:33 [opt]
    frame #14: 0x0000000100214ed0 python.exe`PyErr_SetString [inlined] _PyErr_SetString(tstate=0x00000001005e6370, exception=<unavailable>, string=<unavailable>) at errors.c:291:9 [opt]
    frame #15: 0x0000000100214eb0 python.exe`PyErr_SetString(exception=0x000000010054db80, string=<unavailable>) at errors.c:300:5 [opt]
    frame #16: 0x000000010099bf30 foo.abi3.so`foo_bar(self=<unavailable>, args=<unavailable>) at foo.c:7:2 [opt]
```

OK ，看到问题的部分的代码是这样

```c
static inline void
_PyObject_Init(PyObject *op, PyTypeObject *typeobj)
{
    assert(op != NULL);
    Py_SET_TYPE(op, typeobj);
    assert(_PyType_HasFeature(typeobj, Py_TPFLAGS_HEAPTYPE) || _Py_IsImmortal(typeobj));
    Py_INCREF(typeobj);
    _Py_NewReference(op);
}
```

我们能看到是在处理 `PyExc_TypeError` 对象的时候， 进入到了 `_PyObject_Init` 函数，这里有一个逻辑是判定对象是否是在堆上或者是 Immortal 对象

我们 Bisect 确认了下，这个变更是在 GH-116115[<sup>2</sup>](#reference2) 中引入的，原本的逻辑是这样的

```c
static inline void
_PyObject_Init(PyObject *op, PyTypeObject *typeobj)
{
    assert(op != NULL);
    Py_SET_TYPE(op, typeobj);
    if (_PyType_HasFeature(typeobj, Py_TPFLAGS_HEAPTYPE)) {
        Py_INCREF(typeobj);
    }
    Py_INCREF(typeobj);
    _Py_NewReference(op);
}
```

这里我们需要先去看下 `PyExc_TypeError` 的定义

```c
#define PyObject_HEAD_INIT(type)    \
    {                               \
        { _Py_IMMORTAL_REFCNT },    \
        (type)                      \
    },

#define PyVarObject_HEAD_INIT(type, size) \
    {                                     \
        PyObject_HEAD_INIT(type)          \
        (size)                            \
    },


static PyTypeObject _PyExc_ ## EXCNAME = { \
    PyVarObject_HEAD_INIT(NULL, 0) \
    # EXCNAME, \
    sizeof(Py ## EXCSTORE ## Object), 0, \
    (destructor)EXCSTORE ## _dealloc, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, \
    (reprfunc)EXCSTR, 0, 0, 0, \
    Py_TPFLAGS_DEFAULT | Py_TPFLAGS_BASETYPE | Py_TPFLAGS_HAVE_GC, \
    PyDoc_STR(EXCDOC), (traverseproc)EXCSTORE ## _traverse, \
    (inquiry)EXCSTORE ## _clear, 0, 0, 0, 0, EXCMETHODS, \
    EXCMEMBERS, EXCGETSET, &_ ## EXCBASE, \
    0, 0, 0, offsetof(Py ## EXCSTORE ## Object, dict), \
    (initproc)EXCSTORE ## _init, 0, EXCNEW,\
}; \
PyObject *PyExc_ ## EXCNAME = (PyObject *)&_PyExc_ ## EXCNAME

SimpleExtendsException(PyExc_Exception, TypeError,
                       "Inappropriate argument type.");
```

这里我们能看到（注意 `_Py_IMMORTAL_REFCNT` 和 `Py_TPFLAGS_DEFAULT | Py_TPFLAGS_BASETYPE | Py_TPFLAGS_HAVE_GC`），`PyExc_TypeError` 是一个非堆上 Immortal 对象，在 GH-116115[<sup>2</sup>](#reference2) 之前，我们走到 false 的分支，而在之后，理论上讲 `_PyType_HasFeature(typeobj, Py_TPFLAGS_HEAPTYPE) || _Py_IsImmortal(typeobj)` 应该是一个为 true 的表达式，不应该会 assert failed 才对。那么为什么呢

我们在这里断点一下看一下表达式的值，结果我们惊讶的发现，`_Py_IsImmortal(typeobj)` 也为 false ，为啥捏？

我们先来看一下 `_Py_IsImmortal(typeobj)` 的实现

```c
static inline Py_ALWAYS_INLINE int _Py_IsImmortal(PyObject *op)
{

    return (op->ob_refcnt == _Py_IMMORTAL_REFCNT);
}
```

这里我们能看到，`_Py_IsImmortal` 的实现是判断对象的引用计数是否等于 `_Py_IMMORTAL_REFCNT` ，奇怪，我们之前看到的 `PyExc_TypeError` 的定义里其 Reference Count 是 `_Py_IMMORTAL_REFCNT`， 难道 reference count 发生了什么变化？这个时候我们需要注意到，在 PyErr_SetString 之前我们调用了 `Py_INCREF`，我们来验证下

我们在 foo_bar 函数中加入断点，我们发现，在执行 `Py_INCREF` 后，我们我们的引用技术 +1 ，从而导致了 `_Py_IsImmortal` 的判断为 false

那么这里新的问题又来了，为什么我们在 >= 3.12 的版本上编译的插件，在后续执行正常呢？这种奇怪的问题我们就先来看下汇编

在 3.11 下编译的产物

```asm
0000000000001120 <foo_bar>:
    1120:	48 83 ec 08          	sub    $0x8,%rsp
    1124:	48 8b 05 9d 2e 00 00 	mov    0x2e9d(%rip),%rax        # 3fc8 <PyExc_TypeError@Base>
    112b:	48 8d 35 ce 0e 00 00 	lea    0xece(%rip),%rsi        # 2000 <_fini+0xe9c>
    1132:	48 8b 38             	mov    (%rax),%rdi
    1135:	48 83 07 01          	addq   $0x1,(%rdi)
    1139:	e8 f2 fe ff ff       	call   1030 <PyErr_SetString@plt>
    113e:	31 c0                	xor    %eax,%eax
    1140:	48 83 c4 08          	add    $0x8,%rsp
    1144:	c3                   	ret
    1145:	66 66 2e 0f 1f 84 00 	data16 cs nopw 0x0(%rax,%rax,1)
    114c:	00 00 00 00
```

在 3.13 下编译的产物

```asm
0000000000001120 <foo_bar>:
    1120:	48 83 ec 08          	sub    $0x8,%rsp
    1124:	48 8b 05 9d 2e 00 00 	mov    0x2e9d(%rip),%rax        # 3fc8 <PyExc_TypeError@Base>
    112b:	48 8b 38             	mov    (%rax),%rdi
    112e:	8b 07                	mov    (%rdi),%eax
    1130:	83 c0 01             	add    $0x1,%eax
    1133:	74 02                	je     1137 <foo_bar+0x17>
    1135:	89 07                	mov    %eax,(%rdi)
    1137:	48 8d 35 c2 0e 00 00 	lea    0xec2(%rip),%rsi        # 2000 <_fini+0xe9c>
    113e:	e8 ed fe ff ff       	call   1030 <PyErr_SetString@plt>
    1143:	31 c0                	xor    %eax,%eax
    1145:	48 83 c4 08          	add    $0x8,%rsp
    1149:	c3                   	ret
    114a:	66 0f 1f 44 00 00    	nopw   0x0(%rax,%rax,1)
```

我们能发现我们在 `call   1030 <PyErr_SetString@plt>` 这条指令前的汇编完全不一样，我们这里能归纳出两点

1. PyErr_SetString 调用的地址是在运行时动态解析的
2. 而 `Py_INCREF` 则处理成不同逻辑的汇编了

这种情况只有两种可能

1. `Py_INCREF` 是一组宏定义
2. `Py_INCREF` 是被 inline 处理了

我们来看下 `Py_INCREF` 的定义

```c
static inline Py_ALWAYS_INLINE void Py_INCREF(PyObject *op);
```

果然是第二种情况，那么这种情况就意味着 `Py_INCREF` 的实现在 3.13 和 3.11 中是不一样的，我们来看下代码

3.13 

```c
static inline Py_ALWAYS_INLINE void Py_INCREF(PyObject *op)
{
    if (_Py_IsImmortal(op)) {
        return;
    }
    op->ob_refcnt++;
}
```

3.11

```c
static inline void Py_INCREF(PyObject *op)
{

    op->ob_refcnt++;
}
```

果然，在 3.13 中我们对于 immortal 对象的引用计数不再增加，而 3.11 不会做检查直接增加，这会使 immortal 对象的引用计数不再是 `_Py_IMMORTAL_REFCNT`，从而导致了我们的问题

这个问题那么其实说白了可以这样总结，在 PEP 683 Immortal 对象的实现中，我们将 immortal 的状态和引用技术 mix up 了，导致我们部分 ABI 在低版本 inline 后在高版本中有错误的逻辑。同时我们在 GH-116115[<sup>2</sup>](#reference2) 中收窄了对于对象检测的严谨性，从而导致出现了兼容的问题

这个问题其实修复起来也很容易，目前我和另外一个 Python 核心开发者各自采用了一种处理方式

1. 我是选择将 assert 的部分 revert 到之前的 if condition 检查，这样可以保证对象的兼容性，改动也比较小。缺陷就是算是 case by case 的解决
2. 另外一位核心开发者解决的方式是将 immortal 的检查范围放大（大小于某个区间即可认为是 immortal 对象），这样的好处是可以扩展，而缺陷就是可能让 immortal 对象的实现复杂度进一步提升

不过说白了归根到底还是 PEP 683 实现的时候状态混合了，估计后续还有不少问题

## 总结

这个 case 其实也是个查起来不难，修复不难的问题。但是后面牵扯的东西太多了，很多有趣的讨论可以点进 issue 去看看

## Reference

<div id="reference1"></div>

1. [GH-121528](https://github.com/python/cpython/issues/121528)

<div id="reference2"></div>

2. [GH-116115](https://github.com/python/cpython/pull/116115)

