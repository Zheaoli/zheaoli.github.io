---
title: 怎么样去理解 Python 中的装饰器
type: tags
date: 2018-02-23 02:54:25
tags: [Python,编程,Flask,源码阅读]
categories: [编程,Python]
---


# 怎么样去理解 Python 中的装饰器

首先，本垃圾文档工程师又来了。开始日常的水文写作。起因是看到这个问题[如何理解Python装饰器？](https://www.zhihu.com/question/26930016/)，正好不久前给人讲过这些，本垃圾于是又开始新的一轮辣鸡文章写作行为了。

## 预备知识

首先要理解装饰器，首先要先理解在 Python 中很重要的一个概念就是：“函数是 First Class Member” 。这句话再翻译一下，函数是一种特殊类型的变量，可以和其余变量一样，作为参数传递给函数，也可以作为返回值返回。

<!-- more -->

~~~Python

def abc():
    print("abc")

def abc1(func):
    func()

abc1(abc)
~~~

这段代码的输出就是我们在函数 `abc` 中输出的 `abc` 字符串。过程很简单，我们将函数 `abc` 作为一个参数传递给 `abc1` ，然后，在 `abc1` 中调用传入的函数

再来看一段代码

~~~Python

def abc1():
    def abc():
        print("abc")
    return abc
abc1()()

~~~

这段代码输出和之前的一样，这里我们将在 `abc1` 内部定义的函数 `abc` 作为一个变量返回，然后我们在调用 `abc1` 获取到返回值后，继续调用返回的函数。

好了，我们再来做一个思考题，实现一个函数 `add` ，达到 `add(m)(n)` 等价于 `m+n` 的效果。这题如果把之前的 First-Class Member 这一概念理清楚后，我们便能很清楚的写出来了

~~~Python
def add(m):
    def temp(n):
        return m+n
    return temp
print(add(1)(2))
~~~

嗯，这里输出就是 3 。

## 正文

看了前面的预备知识后，我们便可以开始今天的主题了

### 先来看一个需求吧

现在我们有一个函数

~~~Python

def range_loop(a,b):
    for i in range(a,b):
        temp_result=a+b
    return temp_result
~~~

现在我们要给这个函数加上一些代码，来计算这个函数的运行时间。

我们大概一想，写出了这样的代码

~~~Python
import time
def range_loop(a,b):
    time_flag=time.time()
    for i in range(a,b):
        temp_result=a+b
    print(time.time()-time_flag)
    return temp_result
~~~

先且不论，这样计算时间是不是准确的，现在我们要给如下很多函数加上一个时间计算的功能

~~~Python
import time
def range_loop(a,b):
    time_flag=time.time()
    for i in range(a,b):
        temp_result=a+b
    print(time.time()-time_flag)
    return temp_result
def range_loop1(a,b):
    time_flag=time.time()
    for i in range(a,b):
        temp_result=a+b
    print(time.time()-time_flag)
    return temp_result
def range_loop2(a,b):
    time_flag=time.time()
    for i in range(a,b):
        temp_result=a+b
    print(time.time()-time_flag)
    return temp_result
~~~

我们初略一想，嗯，Ctrl+C,Ctrl+V。emmmm 好了，现在你们不觉得这段代码特别脏么？我们想让他变得干净点怎么办？

我们想了想，按照之前说的 First-Class Member 的概念。然后写出了如下的代码

~~~Python
import time
def time_count(func,a,b):
    time_flag=time.time()
    temp_result=func(a,b)
    print(time.time()-time_flag)
    return temp_result
    
def range_loop(a,b):
    for i in range(a,b):
        temp_result=a+b
    return temp_result
def range_loop1(a,b):
    for i in range(a,b):
        temp_result=a+b
    return temp_result
def range_loop2(a,b):
    for i in range(a,b):
        temp_result=a+b
    return temp_result
time_count(range_loop,a,b)
time_count(range_loop1,a,b)
time_count(range_loop2,a,b)
~~~

嗯，看起来像那么回事，好了好了，我们现在新的问题又来了，我们现在是假设，我们所有函数都只有两个参数传入，那么现在如果想支持任意参数的传入怎么办？我们眉头一皱，写下了如下的代码

~~~Python

import time
def time_count(func,*args,**kwargs):
    time_flag=time.time()
    temp_result=func(*args,**kwargs)
    print(time.time()-time_flag)
    return temp_result
    
def range_loop(a,b):
    for i in range(a,b):
        temp_result=a+b
    return temp_result
def range_loop1(a,b):
    for i in range(a,b):
        temp_result=a+b
    return temp_result
def range_loop2(a,b):
    for i in range(a,b):
        temp_result=a+b
    return temp_result
time_count(range_loop,a,b)
time_count(range_loop1,a,b)
time_count(range_loop2,a,b)

~~~

好了，现在看起来，有点像模像样了，但是我们再想想，这段代码实际上改变了我们的函数调用方式，比如我们直接运行 `range_loop(a,b)` 还是没有办法获取到函数执行时间。那么现在我们如果不想改变函数的调用方式，又想获取到函数的运行时间怎么办？

很简单嘛，替换一下不就好了

~~~Python

import time
def time_count(func):
    def wrap(*args,**kwargs):
        time_flag=time.time()
        temp_result=func(*args,**kwargs)
        print(time.time()-time_flag)
        return temp_result
    return wrap
    
def range_loop(a,b):
    for i in range(a,b):
        temp_result=a+b
    return temp_result
def range_loop1(a,b):
    for i in range(a,b):
        temp_result=a+b
    return temp_result
def range_loop2(a,b):
    for i in range(a,b):
        temp_result=a+b
    return temp_result
range_loop=time_count(range_loop)
range_loop1=time_count(range_loop1)
range_loop2=time_count(range_loop2)
range_loop(1,2)
range_loop1(1,2)
range_loop2(1,2)
~~~

emmmm，这样看起来感觉舒服多了？既没有改变原有的运行方式，也输出了函数运行时间。


但是。。。你们不觉得手动替换太恶心了么？？？喵喵喵？？？还有什么可以简化下的么？？

好了，Python 知道我们是爱吃糖的孩子，给我们提供了一个新的语法糖，这也是今天的男一号，Decorator 装饰器

### 说说 Decorator 

我们前面已经实现了，在不改变函数特性的情况下，给原有的代码新增一点功能，但是我们也觉得这样手动的替换，太恶心了，是的 Python 官方也觉得这样很恶心，所以新的语法糖来了

我们上面的代码可以写成这样了

~~~Python

import time
def time_count(func):
    def wrap(*args,**kwargs):
        time_flag=time.time()
        temp_result=func(*args,**kwargs)
        print(time.time()-time_flag)
        return temp_result
    return wrap
@time_count    
def range_loop(a,b):
    for i in range(a,b):
        temp_result=a+b
    return temp_result
@time_count
def range_loop1(a,b):
    for i in range(a,b):
        temp_result=a+b
    return temp_result
@time_count
def range_loop2(a,b):
    for i in range(a,b):
        temp_result=a+b
    return temp_result
range_loop(1,2)
range_loop1(1,2)
range_loop2(1,2)

~~~

哇，写到这里，你是不是恍然大悟！まさか？？？是的，其实 `@` 符号其实是一个语法糖，他将我们之前的手动替换的过程交给了环境执行。好了用人话描述下，`@` 的作用是将被包裹的函数作为一个变量传递给装饰函数/类，将装饰函数/类返回的值替换原本的函数。

~~~Python
@decorator
def abc():
    pass
~~~

如同前面所讲的一样，实际上是发生了一个特殊的替换过程 `abc=decorator(abc)` ，好了我们来做几个题来练习下吧？

~~~Python

def decorator(func):
    return 1
@decorator
def abc():
    pass
abc()
~~~

这段代码会发生什么？答：会抛出异常。为啥啊？答：因为装饰的时候发生了替换，`abc=decorator(abc)` ，替换后 `abc` 的值为 1 。整数默认不能作为一个函数进行调用。

~~~Python

def time_count(func):
    def wrap(*args,**kwargs):
        time_flag=time.time()
        temp_result=func(*args,**kwargs)
        print(time.time()-time_flag)
        return temp_result
    return wrap

def decorator(func):
    def wrap(*args,**kwargs):
        temp_result=func(*args,**kwargs)
        return temp_result
    return wrap

def decorator1(func):
    def wrap(*args,**kwargs):
        temp_result=func(*args,**kwargs)
        return temp_result
    return wrap

@time_count
@decorator
@decorator1    
def range_loop(a,b):
    for i in range(a,b):
        temp_result=a+b
    return temp_result
~~~

这段代码怎么替换的？答：`time_count(decorator(decorator1(range_loop)))` 

嗯，现在是不是对装饰器什么的有了基本的了解？

### 扩展一下

现在，我想修改下前面写的 `time_count` 函数，让他支持传入一个 `flag` 参数，当 `flag` 为 `True` 的时候，输出函数运行时间，为 `False` 的时候不输出时间

我们一步步来，我们先假设新的函数叫做 `time_count_plus`

我们想实现的效果是这样的

~~~Python
@time_count_plus(flag=True)
def range_loop(a,b):
    for i in range(a,b):
        temp_result=a+b
    return temp_result
~~~

嗯，我们看了下，首先我们调用了 `time_count_plus(flag=True)` 一次，将它返回的值作为一个装饰函数来替换 `range_loop` ，OK 那么我们首先 `time_count_plus` 要接收一个参数，返回一个函数对吧

~~~Python
def time_count_plus(flag=True):
    def wrap1(func):
        pass
    return wrap1
~~~

好了，现在返回了一个函数来作为装饰函数，然后我们说了 `@` 其实触发了一次替换过程，好那么我们现在的替换是不是 `range_loop=time_count_plus(flag=True)(range_loop)` 好了，现在大家应该很清楚了，我们在 `wrap1` 里面是不是还应该有一个函数并返回？

嗯，最终的代码如下

~~~Python
def time_count_plus(flag=True):
    def wrap1(func):
        def wrap2(*args,**kwargs):
            if flag:
                time_flag=time.time()
                temp_result=func(*args,**kwargs)
                print(time.time()-time_flag)
            else:
                temp_result=func(*args,**kwargs)
            return temp_result
        return wrap2
    return wrap1
@time_count_plus(flag=True)
def range_loop(a,b):
    for i in range(a,b):
        temp_result=a+b
    return temp_result

~~~

是不是这样就清楚多啦！

### 扩展两下

好了，我们现在有新的需求来了

~~~Python
m=3
n=2
def add(a,b):
    return a+b

def sub(a,b):
    return a-b

def mul(a,b):
    return a*b

def div(a,b):
    return a/b

~~~

现在我们有字符串 `a` , `a` 的值可能为 `+`、`-`、`*`、`/` 那么现在，我们想根据 `a` 的值来调用对应的函数怎么办？

我们煎蛋一想，嗯，逻辑判断嘛

~~~Python

m=3
n=2
def add(a,b):
    return a+b

def sub(a,b):
    return a-b

def mul(a,b):
    return a*b

def div(a,b):
    return a/b
a=input('请输入 + - * / 中的任意一个\n')
if a=='+':
    print(add(m,n))
elif a=='-':
    print(sub(m-n))
elif a=='*':
    print(mul(m,n))
elif a=='/':
    print(div(m,n))
~~~

但是这段代码，if else 是不是太多了点？我们仔细一想，用一下 First-Class Member 的特性，然后配合 dict 实现操作符和函数之间的关联。

~~~Python
m=3
n=2
def add(a,b):
    return a+b

def sub(a,b):
    return a-b

def mul(a,b):
    return a*b

def div(a,b):
    return a/b
func_dict={"+":add,"-":sub,"*":mul,"/":div}
a=input('请输入 + - * / 中的任意一个\n')
func_dict[a](m,n)
~~~

emmmm，看起来不错啊，但是我们注册的过程能不能再简化一点？ 嗯，这个时候装饰器语法特性就能用上了

~~~Python
m=3
n=2
func_dict={}
def register(operator):
    def wrap(func):
        func_dict[operator]=func
        return func
    return wrap
@register(operator="+")
def add(a,b):
    return a+b
@register(operator="-")
def sub(a,b):
    return a-b
@register(operator="*")
def mul(a,b):
    return a*b
@register(operator="/")
def div(a,b):
    return a/b

a=input('请输入 + - * / 中的任意一个\n')
func_dict[a](m,n)
~~~

嗯，还记得我们前面说的使用 `@` 语法的时候，实际上是触发了一个替换的过程么？这里就是利用这一特性，在装饰器触发的时候，注册函数映射，这样我们直接根据 'a' 的值来获取函数处理数据。另外请注意一点，我们这里没有必要修改原函数，所以我们没有必要写第三层的函数。

如果有熟悉 Flask 同学就知道，在调用 `route` 方法注册路由的时候，也是使用了这一特性 ，可以参考另外一篇很久前写的垃圾水文 [菜鸟阅读 Flask 源码系列（1）：Flask的router初探](http://manjusaka.itscoder.com/2016/08/09/reading-the-fucking-flask-source-code-Part1/)

## 总结

其实全文下来，大家应该能知道这样一点东西。Python 中的装饰器其实是 First-Class Member 概念的更进一层应用，我们将函数传递给其余函数，包裹上新的功能后再行返回。`@` 其实只是将这样一个过程进行了简化而已。在 Python 中，装饰器无处不在，很多官方库中的实现也依赖于装饰器，比如很久之前写过这样一篇垃圾水文 [菜鸟阅读 Flask 源码系列（1）：Flask的router初探](http://manjusaka.itscoder.com/2016/10/12/Something-about-Descriptor/)。

嗯，今天就先写到这里吧！