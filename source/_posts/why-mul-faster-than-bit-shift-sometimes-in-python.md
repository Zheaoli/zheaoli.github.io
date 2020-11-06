---
title: 为什么有些时候 Python 中乘法比位运算更快
type: tags
date: 2020-11-06 22:09:00
tags: [编程,Python,随笔]
categories: [编程,Python]
---

我本来以为我不再会写水文了，但是突然发现自己现在也只能勉强写写水文才能维持生活这样子。那就继续写水文吧

<!--more-->

某天，一个技术群里老哥提出了这样一个问题，为什么在一些情况下，Python 中的简单乘/除法比位运算要慢

首先秉持着实事求是的精神，我们先来验证一下

```bash
In [33]: %timeit 1073741825*2                                                                                                                                                                                                                                                                           
7.47 ns ± 0.0843 ns per loop (mean ± std. dev. of 7 runs, 100000000 loops each)

In [34]: %timeit 1073741825<<1                                                                                                                                                                                                                                                                          
7.43 ns ± 0.0451 ns per loop (mean ± std. dev. of 7 runs, 100000000 loops each)

In [35]: %timeit 1073741823<<1                                                                                                                                                                                                                                                                          
7.48 ns ± 0.0621 ns per loop (mean ± std. dev. of 7 runs, 100000000 loops each)

In [37]: %timeit 1073741823*2                                                                                                                                                                                                                                                                           
7.47 ns ± 0.0564 ns per loop (mean ± std. dev. of 7 runs, 100000000 loops each)
``` 

我们发现几个很有趣的现象

1. 在值 `x<=2^30` 时，乘法比直接位运算要快
2. 在值 `x>2^32` 时，乘法显著慢于位运算


这个现象很有趣，那么这个现象的 `root cause` 是什么？实际上这和 Python 底层的实现有关

## 简单聊聊

### PyLongObject 的实现

在 Python 2.x 时期，Python 中将整型分为两类，一类是 **long**, 一类是 **int** 。在 Python3 中这两者进行了合并。目前在 Python3 中这两者做了合并，仅剩一个 **long** 

首先来看看 **long** 这样一个数据结构底层的实现

```c
struct _longobject {
    PyObject_VAR_HEAD
    digit ob_digit[1];
};
```

在这里不用关心，**PyObject_VAR_HEAD** 的含义，我们只需要关心 **ob_digit** 即可。

在这里，`ob_digit` 是使用了 C99 中的“柔性数组”来实现任意长度的整数的存储。这里我们可以看一下官方代码中的文档

> Long integer representation.The absolute value of a number is equal to SUM(for i=0 through abs(ob_size)-1) ob_digit[i] * 2**(SHIFT*i) 
> Negative numbers are represented with ob_size < 0; zero is represented by ob_size == 0. 
> In a normalized number, ob_digit[abs(ob_size)-1] (the most significant digit) is never zero.  Also, in all cases, for all valid i,0 <= ob_digit[i] <= MASK.
> The allocation function takes care of allocating extra memory so that ob_digit[0] ... ob_digit[abs(ob_size)-1] are actually available.
> CAUTION:  Generic code manipulating subtypes of PyVarObject has to aware that ints abuse  ob_size's sign bit.

简而言之，Python 是将一个十进制数转为 **2^(SHIFT)** 进制数来进行存储。这里可能不太好了理解。我来举个例子，在我的电脑上，SHIFT 为 30 ，假设现在有整数 1152921506754330628 ，那么将起转为 2^30 进制表示则为: 4*(2^30)^0+2*(2^30)^1+1*(2^30)^2 。那么此时 `ob_digit` 是一个含有三个元素的数组，其值为 [4,2,1]

OK，在明白了这样一些基础知识后，我们回过头去看看 Python 中的乘法运算

### Python 中的乘法运算

Python 中的乘法运算，分为两部分，其中关于大数的乘法，Python 使用了 **Karatsuba 算法**[<sup>1</sup>](#refer-anchor-1)，具体实现如下

```c
static PyLongObject *
k_mul(PyLongObject *a, PyLongObject *b)
{
    Py_ssize_t asize = Py_ABS(Py_SIZE(a));
    Py_ssize_t bsize = Py_ABS(Py_SIZE(b));
    PyLongObject *ah = NULL;
    PyLongObject *al = NULL;
    PyLongObject *bh = NULL;
    PyLongObject *bl = NULL;
    PyLongObject *ret = NULL;
    PyLongObject *t1, *t2, *t3;
    Py_ssize_t shift;           /* the number of digits we split off */
    Py_ssize_t i;

    /* (ah*X+al)(bh*X+bl) = ah*bh*X*X + (ah*bl + al*bh)*X + al*bl
     * Let k = (ah+al)*(bh+bl) = ah*bl + al*bh  + ah*bh + al*bl
     * Then the original product is
     *     ah*bh*X*X + (k - ah*bh - al*bl)*X + al*bl
     * By picking X to be a power of 2, "*X" is just shifting, and it's
     * been reduced to 3 multiplies on numbers half the size.
     */

    /* We want to split based on the larger number; fiddle so that b
     * is largest.
     */
    if (asize > bsize) {
        t1 = a;
        a = b;
        b = t1;

        i = asize;
        asize = bsize;
        bsize = i;
    }

    /* Use gradeschool math when either number is too small. */
    i = a == b ? KARATSUBA_SQUARE_CUTOFF : KARATSUBA_CUTOFF;
    if (asize <= i) {
        if (asize == 0)
            return (PyLongObject *)PyLong_FromLong(0);
        else
            return x_mul(a, b);
    }

    /* If a is small compared to b, splitting on b gives a degenerate
     * case with ah==0, and Karatsuba may be (even much) less efficient
     * than "grade school" then.  However, we can still win, by viewing
     * b as a string of "big digits", each of width a->ob_size.  That
     * leads to a sequence of balanced calls to k_mul.
     */
    if (2 * asize <= bsize)
        return k_lopsided_mul(a, b);

    /* Split a & b into hi & lo pieces. */
    shift = bsize >> 1;
    if (kmul_split(a, shift, &ah, &al) < 0) goto fail;
    assert(Py_SIZE(ah) > 0);            /* the split isn't degenerate */

    if (a == b) {
        bh = ah;
        bl = al;
        Py_INCREF(bh);
        Py_INCREF(bl);
    }
    else if (kmul_split(b, shift, &bh, &bl) < 0) goto fail;

    /* The plan:
     * 1. Allocate result space (asize + bsize digits:  that's always
     *    enough).
     * 2. Compute ah*bh, and copy into result at 2*shift.
     * 3. Compute al*bl, and copy into result at 0.  Note that this
     *    can't overlap with #2.
     * 4. Subtract al*bl from the result, starting at shift.  This may
     *    underflow (borrow out of the high digit), but we don't care:
     *    we're effectively doing unsigned arithmetic mod
     *    BASE**(sizea + sizeb), and so long as the *final* result fits,
     *    borrows and carries out of the high digit can be ignored.
     * 5. Subtract ah*bh from the result, starting at shift.
     * 6. Compute (ah+al)*(bh+bl), and add it into the result starting
     *    at shift.
     */

    /* 1. Allocate result space. */
    ret = _PyLong_New(asize + bsize);
    if (ret == NULL) goto fail;
#ifdef Py_DEBUG
    /* Fill with trash, to catch reference to uninitialized digits. */
    memset(ret->ob_digit, 0xDF, Py_SIZE(ret) * sizeof(digit));
#endif

    /* 2. t1 <- ah*bh, and copy into high digits of result. */
    if ((t1 = k_mul(ah, bh)) == NULL) goto fail;
    assert(Py_SIZE(t1) >= 0);
    assert(2*shift + Py_SIZE(t1) <= Py_SIZE(ret));
    memcpy(ret->ob_digit + 2*shift, t1->ob_digit,
           Py_SIZE(t1) * sizeof(digit));

    /* Zero-out the digits higher than the ah*bh copy. */
    i = Py_SIZE(ret) - 2*shift - Py_SIZE(t1);
    if (i)
        memset(ret->ob_digit + 2*shift + Py_SIZE(t1), 0,
               i * sizeof(digit));

    /* 3. t2 <- al*bl, and copy into the low digits. */
    if ((t2 = k_mul(al, bl)) == NULL) {
        Py_DECREF(t1);
        goto fail;
    }
    assert(Py_SIZE(t2) >= 0);
    assert(Py_SIZE(t2) <= 2*shift); /* no overlap with high digits */
    memcpy(ret->ob_digit, t2->ob_digit, Py_SIZE(t2) * sizeof(digit));

    /* Zero out remaining digits. */
    i = 2*shift - Py_SIZE(t2);          /* number of uninitialized digits */
    if (i)
        memset(ret->ob_digit + Py_SIZE(t2), 0, i * sizeof(digit));

    /* 4 & 5. Subtract ah*bh (t1) and al*bl (t2).  We do al*bl first
     * because it's fresher in cache.
     */
    i = Py_SIZE(ret) - shift;  /* # digits after shift */
    (void)v_isub(ret->ob_digit + shift, i, t2->ob_digit, Py_SIZE(t2));
    Py_DECREF(t2);

    (void)v_isub(ret->ob_digit + shift, i, t1->ob_digit, Py_SIZE(t1));
    Py_DECREF(t1);

    /* 6. t3 <- (ah+al)(bh+bl), and add into result. */
    if ((t1 = x_add(ah, al)) == NULL) goto fail;
    Py_DECREF(ah);
    Py_DECREF(al);
    ah = al = NULL;

    if (a == b) {
        t2 = t1;
        Py_INCREF(t2);
    }
    else if ((t2 = x_add(bh, bl)) == NULL) {
        Py_DECREF(t1);
        goto fail;
    }
    Py_DECREF(bh);
    Py_DECREF(bl);
    bh = bl = NULL;

    t3 = k_mul(t1, t2);
    Py_DECREF(t1);
    Py_DECREF(t2);
    if (t3 == NULL) goto fail;
    assert(Py_SIZE(t3) >= 0);

    /* Add t3.  It's not obvious why we can't run out of room here.
     * See the (*) comment after this function.
     */
    (void)v_iadd(ret->ob_digit + shift, i, t3->ob_digit, Py_SIZE(t3));
    Py_DECREF(t3);

    return long_normalize(ret);

  fail:
    Py_XDECREF(ret);
    Py_XDECREF(ah);
    Py_XDECREF(al);
    Py_XDECREF(bh);
    Py_XDECREF(bl);
    return NULL;
}
```

这里不对 **Karatsuba 算法**[<sup>1</sup>](#refer-anchor-1) 的实现做单独解释，有兴趣的朋友可以参考文末的 reference 去了解具体的详情。

在普通情况下，普通乘法的时间复杂度位 n^2 (n 为位数），而 K 算法的时间复杂度为 3n^(log3) ≈ 3n^1.585 ，看起来 K 算法的性能要优于普通乘法，那么为什么 Python 不全部使用 K 算法呢？

很简单，K 算法的优势实际上要在当 n 足够大的时候，才会对普通乘法形成优势。同时考虑到内存访问等因素，当 n 不够大时，实际上采用 K 算法的性能将差于直接进行乘法。

所以我们来看看 Python 中乘法的实现

```c
static PyObject *
long_mul(PyLongObject *a, PyLongObject *b)
{
    PyLongObject *z;

    CHECK_BINOP(a, b);

    /* fast path for single-digit multiplication */
    if (Py_ABS(Py_SIZE(a)) <= 1 && Py_ABS(Py_SIZE(b)) <= 1) {
        stwodigits v = (stwodigits)(MEDIUM_VALUE(a)) * MEDIUM_VALUE(b);
        return PyLong_FromLongLong((long long)v);
    }

    z = k_mul(a, b);
    /* Negate if exactly one of the inputs is negative. */
    if (((Py_SIZE(a) ^ Py_SIZE(b)) < 0) && z) {
        _PyLong_Negate(&z);
        if (z == NULL)
            return NULL;
    }
    return (PyObject *)z;
}
```

在这里我们看到，当两个数皆小于 2^30-1 时，Python 将直接使用普通乘法并返回，否则将使用 K 算法进行计算

这个时候，我们来看一下位运算的实现，以右移为例

```python

static PyObject *
long_rshift(PyObject *a, PyObject *b)
{
    Py_ssize_t wordshift;
    digit remshift;

    CHECK_BINOP(a, b);

    if (Py_SIZE(b) < 0) {
        PyErr_SetString(PyExc_ValueError, "negative shift count");
        return NULL;
    }
    if (Py_SIZE(a) == 0) {
        return PyLong_FromLong(0);
    }
    if (divmod_shift(b, &wordshift, &remshift) < 0)
        return NULL;
    return long_rshift1((PyLongObject *)a, wordshift, remshift);
}

static PyObject *
long_rshift1(PyLongObject *a, Py_ssize_t wordshift, digit remshift)
{
    PyLongObject *z = NULL;
    Py_ssize_t newsize, hishift, i, j;
    digit lomask, himask;

    if (Py_SIZE(a) < 0) {
        /* Right shifting negative numbers is harder */
        PyLongObject *a1, *a2;
        a1 = (PyLongObject *) long_invert(a);
        if (a1 == NULL)
            return NULL;
        a2 = (PyLongObject *) long_rshift1(a1, wordshift, remshift);
        Py_DECREF(a1);
        if (a2 == NULL)
            return NULL;
        z = (PyLongObject *) long_invert(a2);
        Py_DECREF(a2);
    }
    else {
        newsize = Py_SIZE(a) - wordshift;
        if (newsize <= 0)
            return PyLong_FromLong(0);
        hishift = PyLong_SHIFT - remshift;
        lomask = ((digit)1 << hishift) - 1;
        himask = PyLong_MASK ^ lomask;
        z = _PyLong_New(newsize);
        if (z == NULL)
            return NULL;
        for (i = 0, j = wordshift; i < newsize; i++, j++) {
            z->ob_digit[i] = (a->ob_digit[j] >> remshift) & lomask;
            if (i+1 < newsize)
                z->ob_digit[i] |= (a->ob_digit[j+1] << hishift) & himask;
        }
        z = maybe_small_long(long_normalize(z));
    }
    return (PyObject *)z;
}
```

在这里我们能看到，在两侧都是小数的情况下，位移动算法将比普通乘法，存在更多的内存分配等操作。这样也会回答了我们文初所提到的一个问题，“为什么一些时候乘法比位运算更快”。

## 总结

本文差不多就到这里了，实际上通过这次分析我们能得到一些很有趣但是也很冷门的知识。实际上我们目前看到这样一个结果，是 Python 对于我们常见且高频的操作所做的一个特定的设计。而这也提醒我们，Python 实际上对于很多操作都存在自己内建的设计哲学，在日常使用的时候，其余语言的经验，可能无法复用

差不多就这样吧，只能勉强写水文苟活了（逃

## Reference

<div id="refer-anchor-1"></div>

- [1]. [Karatsuba 算法](https://zh.wikipedia.org/wiki/Karatsuba%E7%AE%97%E6%B3%95)