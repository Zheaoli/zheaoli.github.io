---
title: 随便聊聊 PEP570
type: tags
date: 2019-04-27 18:48:30
tags: [Python,编程,PEP,编程技巧]
categories: [编程,Python]
---

最近沉迷与 MIT 6.824 这门分布式系统的课，无心写文章。不过看到 [PEP570](https://www.python.org/dev/peps/pep-0570) 被接受了，决定还是写篇水文随便聊聊 PEP 570

<!--more-->

## Python 的 argument

在聊 PEP570 之前，我们先要来看看 Python 的 argument 变迁

早在 Python 1.0 或更早，Python 的 argument 系统就已经支持我们现在主要使用的两种参数形式了，一种是 positional 一种是 keyword，举几个例子

```python

def abc(a, b, c):
    pass


abc(1, 2, 3)
abc(1, 2, c=3)
abc(1, b=2, c=3)
abc(*(1, 2, 3))
abc(**{"a": 1, "b": 2, "c": 3})

```

这是不是我们常见的集中使用方式？

在发展了很长一段时间后，虽然期间有一些提案对 Python 的 argument 系统做优化和增强，但是一直都被 Reject，直到 [PEP3102](https://www.python.org/dev/peps/pep-3102/) 的出现

3102 主要引入了一个概念叫做 Keyword-Only Arguments，给个例子

有这样一个函数定义

```python
def abc(a, *, b, c):
    pass
```

那么这个函数只支持这样几种方式调用

```python
def abc(a, *, b, c):
    pass


abc(**{"a": 1, "b": 2, "c": 3})
abc(a=1, b=2, c=3)
abc(1, b=2, c=3)
```

OK，大概聊完 Argument 一个迭代的过程，我们来聊聊 570 这个提案

## 随便聊聊 PEP 570

570 做的事情其和 3102 类似，3102 是引入语法糖，让函数支持 keyword-only 的使用方式，那么 570 就是让函数支持 positional-only 的使用方式

假定有这样一个函数定义

```python
def abc(a, b, /, c):
    pass
```

那么 570 使得函数只支持这样的调用方式

```python
def abc(a, b, /, c):
    pass


abc(1, 2, c=3)
abc(1, 2, 3)
```

如果不这样做会怎么样呢？我们可以来试试，目前 PEP570 有一个实现，参见 [bpo-36540: PEP 570 -- Implementation](https://github.com/python/cpython/pull/12701)，我们来编译测试一下，效果如下

![image](https://user-images.githubusercontent.com/7054676/56848232-032eac00-6919-11e9-9312-d2d73b641f12.png)

## 碎碎念

很多人其实没想清楚关于 570 的存在意义，PEP 570 上也提到了很多 Motivation 。不过我自己觉得，它和 3102 一样都是在践行一个理念，则

> explicit is better than implicit

换句话说，如果要尽可能的保证代码风格的一致性，我们需要一定程度上语法特性的支持。而 570 和 3102 就是解决这样的问题。

所以从我自己的角度来说，我觉得 570 是个蛮重要的提案，也是很有意义的提案（都是 PEP57x ，为啥大家待遇能差这么多呢？（笑

对了，讲个段子， Python 的 Core 之一 Serhiy Storchaka 非常喜欢这个 PEP，然后在 PEP570 的实现没合并到主分支之前，就已经先把内置的一些库给改良了一下，大家可以去围观一下 PR [[WIP] Use PEP 570 syntax for positional-only parameters](https://github.com/python/cpython/pull/12620)

好了，今天的水文就到此结束了。。我写文章真的是越来越水了。。