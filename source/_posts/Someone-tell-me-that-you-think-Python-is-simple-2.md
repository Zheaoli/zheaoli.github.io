---
title: 听说你会 Python （2）：Python 高阶数据结构解析
type: tags
date: 2016-12-28 10:02:57
tags: [Python,编程,黑魔法,编程技巧]
categories: [编程,Python]
---
# 前言
之前写过一篇[《听说你会 Python ？》](http://manjusaka.itscoder.com/2016/11/18/Someone-tell-me-that-you-think-Python-is-simple/)的文章，大家反响都还不错，那么我想干脆把这个文章做成一个系列，继续讲解一下 Python 当中那些不为人知的细节吧。然后之前在和师父川爷讨论面试的时候，川爷说了一句“要是我，我就考考你们怎么去实现一个 `namedtuple` ，好用，方便，又能区分人”，说者无心，听者有意，我于是决定在这次的文章中，和大家聊一聊 Python 中一个特殊的高阶数据结构， namedtuple 的实现。
<!--more-->

# Let's begin

## namedtuple

### 介绍

`tuple` 是 Python 中 **build-in** 的一种特殊的数据结构，它是一种 **immutable** 的数据集合，我们经常会这样使用它

~~~Python
def test():
    a = (1, 2)
    print(a)
    return a


if __name__ == '__main__':
    b, c = test()
    print(a)
~~~

Right，很多时候我们会直接使用 `tuple` 来进行一些数据的 packing/unpacking 的操作。OK，关于 `tuple` 的科普就到这里。那么什么是 `namedtuple` 呢，恩，前面不是说了 `tuple` 是一种特殊的数据集合么，那么 `namedtuple` 是其一个进阶（这不是废话么）。它将会基础的 `tuple` 抽象成一个类，我们将自行定义变量的名称和类的名称，这样我们可以很方便的将其复用并管理。具体的用法我们可以看看下面这个例子

~~~Python
if __name__ == '__main__':
    fuck=namedtuple("fuck", ['x', 'y'])
    a=fuck(1,2)
    print(a.x)
    print(a.y)
~~~

恩，这样看起来貌似更直观了点，但是，但是，但是，我猜你肯定想知道 `namedtuple` 是怎么实现的，那么我们先来看看代码吧

### 详解

~~~Python
_class_template = '''\
class {typename}(tuple):
    '{typename}({arg_list})'

    __slots__ = ()

    _fields = {field_names!r}

    def __new__(_cls, {arg_list}):
        'Create new instance of {typename}({arg_list})'
        return _tuple.__new__(_cls, ({arg_list}))

    @classmethod
    def _make(cls, iterable, new=tuple.__new__, len=len):
        'Make a new {typename} object from a sequence or iterable'
        result = new(cls, iterable)
        if len(result) != {num_fields:d}:
            raise TypeError('Expected {num_fields:d} arguments, got %d' % len(result))
        return result

    def __repr__(self):
        'Return a nicely formatted representation string'
        return '{typename}({repr_fmt})' % self

    def _asdict(self):
        'Return a new OrderedDict which maps field names to their values'
        return OrderedDict(zip(self._fields, self))

    def _replace(_self, **kwds):
        'Return a new {typename} object replacing specified fields with new values'
        result = _self._make(map(kwds.pop, {field_names!r}, _self))
        if kwds:
            raise ValueError('Got unexpected field names: %r' % kwds.keys())
        return result

    def __getnewargs__(self):
        'Return self as a plain tuple.  Used by copy and pickle.'
        return tuple(self)

    __dict__ = _property(_asdict)

    def __getstate__(self):
        'Exclude the OrderedDict from pickling'
        pass

{field_defs}
'''

_repr_template = '{name}=%r'

_field_template = '''\
    {name} = _property(_itemgetter({index:d}), doc='Alias for field number {index:d}')
'''

def namedtuple(typename, field_names, verbose=False, rename=False):
    """Returns a new subclass of tuple with named fields.

    >>> Point = namedtuple('Point', ['x', 'y'])
    >>> Point.__doc__                   # docstring for the new class
    'Point(x, y)'
    >>> p = Point(11, y=22)             # instantiate with positional args or keywords
    >>> p[0] + p[1]                     # indexable like a plain tuple
    33
    >>> x, y = p                        # unpack like a regular tuple
    >>> x, y
    (11, 22)
    >>> p.x + p.y                       # fields also accessible by name
    33
    >>> d = p._asdict()                 # convert to a dictionary
    >>> d['x']
    11
    >>> Point(**d)                      # convert from a dictionary
    Point(x=11, y=22)
    >>> p._replace(x=100)               # _replace() is like str.replace() but targets named fields
    Point(x=100, y=22)

    """

    # Validate the field names.  At the user's option, either generate an error
    # message or automatically replace the field name with a valid name.
    if isinstance(field_names, basestring):
        field_names = field_names.replace(',', ' ').split()
    field_names = map(str, field_names)
    typename = str(typename)
    if rename:
        seen = set()
        for index, name in enumerate(field_names):
            if (not all(c.isalnum() or c=='_' for c in name)
                or _iskeyword(name)
                or not name
                or name[0].isdigit()
                or name.startswith('_')
                or name in seen):
                field_names[index] = '_%d' % index
            seen.add(name)
    for name in [typename] + field_names:
        if type(name) != str:
            raise TypeError('Type names and field names must be strings')
        if not all(c.isalnum() or c=='_' for c in name):
            raise ValueError('Type names and field names can only contain '
                             'alphanumeric characters and underscores: %r' % name)
        if _iskeyword(name):
            raise ValueError('Type names and field names cannot be a '
                             'keyword: %r' % name)
        if name[0].isdigit():
            raise ValueError('Type names and field names cannot start with '
                             'a number: %r' % name)
    seen = set()
    for name in field_names:
        if name.startswith('_') and not rename:
            raise ValueError('Field names cannot start with an underscore: '
                             '%r' % name)
        if name in seen:
            raise ValueError('Encountered duplicate field name: %r' % name)
        seen.add(name)

    # Fill-in the class template
    class_definition = _class_template.format(
        typename = typename,
        field_names = tuple(field_names),
        num_fields = len(field_names),
        arg_list = repr(tuple(field_names)).replace("'", "")[1:-1],
        repr_fmt = ', '.join(_repr_template.format(name=name)
                             for name in field_names),
        field_defs = '\n'.join(_field_template.format(index=index, name=name)
                               for index, name in enumerate(field_names))
    )
    if verbose:
        print class_definition

    # Execute the template string in a temporary namespace and support
    # tracing utilities by setting a value for frame.f_globals['__name__']
    namespace = dict(_itemgetter=_itemgetter, __name__='namedtuple_%s' % typename,
                     OrderedDict=OrderedDict, _property=property, _tuple=tuple)
    try:
        exec class_definition in namespace
    except SyntaxError as e:
        raise SyntaxError(e.message + ':\n' + class_definition)
    result = namespace[typename]

    # For pickling to work, the __module__ variable needs to be set to the frame
    # where the named tuple is created.  Bypass this step in environments where
    # sys._getframe is not defined (Jython for example) or sys._getframe is not
    # defined for arguments greater than 0 (IronPython).
    try:
        result.__module__ = _sys._getframe(1).f_globals.get('__name__', '__main__')
    except (AttributeError, ValueError):
        pass

    return result
~~~

这，这，这，这特么什么玩意儿啊！没事,我们慢慢来看。
首先，下面这一部分代码，将会校验我们传入的数据是否符合要求

~~~Python
if isinstance(field_names, basestring):
    field_names = field_names.replace(',', ' ').split()
field_names = map(str, field_names)
typename = str(typename)
if rename:
    seen = set()
    for index, name in enumerate(field_names):
        if (not all(c.isalnum() or c=='_' for c in name)
            or _iskeyword(name)
            or not name
            or name[0].isdigit()
            or name.startswith('_')
            or name in seen):
            field_names[index] = '_%d' % index
        seen.add(name)
for name in [typename] + field_names:
    if type(name) != str:
        raise TypeError('Type names and field names must be strings')
    if not all(c.isalnum() or c=='_' for c in name):
        raise ValueError('Type names and field names can only contain '
                         'alphanumeric characters and underscores: %r' % name)
    if _iskeyword(name):
        raise ValueError('Type names and field names cannot be a '
                         'keyword: %r' % name)
    if name[0].isdigit():
        raise ValueError('Type names and field names cannot start with '
                         'a number: %r' % name)
seen = set()
for name in field_names:
    if name.startswith('_') and not rename:
        raise ValueError('Field names cannot start with an underscore: '
                         '%r' % name)
    if name in seen:
        raise ValueError('Encountered duplicate field name: %r' % name)
    seen.add(name)
~~~

接着，便是我们 `namedtuple` 的核心代码

~~~Python
class_definition = _class_template.format(
    typename = typename,
    field_names = tuple(field_names),
    num_fields = len(field_names),
    arg_list = repr(tuple(field_names)).replace("'", "")[1:-1],
    repr_fmt = ', '.join(_repr_template.format(name=name)
                         for name in field_names),
    field_defs = '\n'.join(_field_template.format(index=index, name=name)
                           for index, name in enumerate(field_names))
)
if verbose:
    print class_definition

# Execute the template string in a temporary namespace and support
# tracing utilities by setting a value for frame.f_globals['__name__']
namespace = dict(_itemgetter=_itemgetter, __name__='namedtuple_%s' % typename,
                 OrderedDict=OrderedDict, _property=property, _tuple=tuple)
try:
    exec class_definition in namespace
except SyntaxError as e:
    raise SyntaxError(e.message + ':\n' + class_definition)
result = namespace[typename]
~~~

你是不是想说，what the fuck！我知道，`class_definition` 、 `_repr_template` 和 `_field_template` 是前面所定义的字符串模板

~~~Python
_class_template = '''\
class {typename}(tuple):
    '{typename}({arg_list})'

    __slots__ = ()

    _fields = {field_names!r}

    def __new__(_cls, {arg_list}):
        'Create new instance of {typename}({arg_list})'
        return _tuple.__new__(_cls, ({arg_list}))

    @classmethod
    def _make(cls, iterable, new=tuple.__new__, len=len):
        'Make a new {typename} object from a sequence or iterable'
        result = new(cls, iterable)
        if len(result) != {num_fields:d}:
            raise TypeError('Expected {num_fields:d} arguments, got %d' % len(result))
        return result

    def __repr__(self):
        'Return a nicely formatted representation string'
        return '{typename}({repr_fmt})' % self

    def _asdict(self):
        'Return a new OrderedDict which maps field names to their values'
        return OrderedDict(zip(self._fields, self))

    def _replace(_self, **kwds):
        'Return a new {typename} object replacing specified fields with new values'
        result = _self._make(map(kwds.pop, {field_names!r}, _self))
        if kwds:
            raise ValueError('Got unexpected field names: %r' % kwds.keys())
        return result

    def __getnewargs__(self):
        'Return self as a plain tuple.  Used by copy and pickle.'
        return tuple(self)

    __dict__ = _property(_asdict)

    def __getstate__(self):
        'Exclude the OrderedDict from pickling'
        pass

{field_defs}
'''

_repr_template = '{name}=%r'

_field_template = '''\
    {name} = _property(_itemgetter({index:d}), doc='Alias for field number {index:d}')
'''
~~~
但是其余的是什么鬼啊！别急，字符串模板我们先放在一边，我们先来看看后面的一段代码

~~~Python
namespace = dict(_itemgetter=_itemgetter, __name__='namedtuple_%s' % typename,
                     OrderedDict=OrderedDict, _property=property, _tuple=tuple)
try:
    exec class_definition in namespace
except SyntaxError as e:
    raise SyntaxError(e.message + ':\n' + class_definition)
result = namespace[typename]
~~~

在这段代码中，首先 `namespace` 变量是一个字典，里面设置了一些变量的存在，紧接就是 `exec class_definition in namespace` 。众所周知，Python 是一门动态语言，在 Python 中，解释器允许我们在运行时，生成一些包含了符合 Python 语法语句的字符串，并用 `exec` 将其作为 Python 代码进行执行。同时在我们生成一些语句字符串的时候，我们可能会使用一些自定义的变量，于是，我们需要提供一个 `dict` 供其进行变量的查找。知道前面这些知识点后，`exec class_definition in namespace` 的作用是不是就很清楚了捏。
好了，我们再回过头去看 `class_definition` 定义。不过我们直接看未格式化之前的模板未免的太过于枯燥和难懂了，我们干脆以前面举过的一个例子来看看格式化后的 `class_definition` 吧~

~~~Python
class fuck(tuple):
    'fuck(x, y)'

    __slots__ = ()

    _fields = ('x', 'y')

    def __new__(_cls, x, y):
        'Create new instance of fuck(x, y)'
        return _tuple.__new__(_cls, (x, y))

    @classmethod
    def _make(cls, iterable, new=tuple.__new__, len=len):
        'Make a new fuck object from a sequence or iterable'
        result = new(cls, iterable)
        if len(result) != 2:
            raise TypeError('Expected 2 arguments, got %d' % len(result))
        return result

    def __repr__(self):
        'Return a nicely formatted representation string'
        return 'fuck(x=%r, y=%r)' % self

    def _asdict(self):
        'Return a new OrderedDict which maps field names to their values'
        return OrderedDict(zip(self._fields, self))

    def _replace(_self, **kwds):
        'Return a new fuck object replacing specified fields with new values'
        result = _self._make(map(kwds.pop, ('x', 'y'), _self))
        if kwds:
            raise ValueError('Got unexpected field names: %r' % kwds.keys())
        return result

    def __getnewargs__(self):
        'Return self as a plain tuple.  Used by copy and pickle.'
        return tuple(self)

    __dict__ = _property(_asdict)

    def __getstate__(self):
        'Exclude the OrderedDict from pickling'
        pass

    x = _property(_itemgetter(0), doc='Alias for field number 0')

    y = _property(_itemgetter(1), doc='Alias for field number 1')
~~~
好了，让我们一点点来分析，首先 `class fuck(tuple)` 指明我们创建的 `fuck` 类是继承自 `tuple` 。紧接着 `__new__` 是 Python 对象系统中的一个特殊方法，用于我们的实例化的操作，其在 `__init__` 之前便被触发，其是一个特殊的静态方法，我们可以将其用于实例缓存等特殊的功能。在这里，`__new__` 将会返回一个 `tuple` 的实例。
接下来的是是一些特殊的私有方法，代码很好懂，我们就不细讲了，接着我们来看看这样一段代码

~~~Python
x = _property(_itemgetter(0), doc='Alias for field number 0')

y = _property(_itemgetter(1), doc='Alias for field number 1')
~~~

你可能还不知道这两段代码用来是干什么的233，没事儿，我们慢慢来。
还记得前面我们举过的一个例子么

~~~Python
if __name__ == '__main__':
    fuck=namedtuple("fuck", ['x', 'y'])
    a=fuck(1,2)
    print(a.x)
    print(a.y)
~~~

你可能会突发奇想，要是我们执行 `a.x=1` 这样的操作会怎样呢？OK，你会发现，Python 会抛出一个异常叫做 `AttributeError: can't set attribute` ，嗯哼，讲到这里，你可能就知道前面提到的包含 `property` 的两行代码作用就是保证 `namedtuple` 的 **immutable** 的特性。那么你可能还是不知道这是为什么。这和 Python 增加的描述符机制有关

### 扩展（1）：Python 中的描述符

首先我们要明确一点，描述符指的是实现了描述符协议的特殊的类，三个描述符协议指的是 `__get__` , '__set__' , `__delete__`  以及 Python 3.6 中新增的 `__set_name__` 方法，其中实现了 `__get__` 以及 `__set__` / `__delete__` / `__set_name__` 的是 **Data descriptors** ，而只实现了 `__get__` 的是 `Non-Data descriptor` 。那么有什么区别呢，前面说了， **我们如果调用一个属性，那么其顺序是优先从实例的 `__dict__` 里查找，然后如果没有查找到的话，那么一次查询类字典，父类字典，直到彻底查不到为止。** 但是，这里没有考虑描述符的因素进去，如果将描述符因素考虑进去，那么正确的表述应该是**我们如果调用一个属性，那么其顺序是优先从实例的 `__dict__` 里查找，然后如果没有查找到的话，那么一次查询类字典，父类字典，直到彻底查不到为止。其中如果在类实例字典中的该属性是一个 `Data descriptors` ，那么无论实例字典中存在该属性与否，无条件走描述符协议进行调用，在类实例字典中的该属性是一个 `Non-Data descriptors` ，那么优先调用实例字典中的属性值而不触发描述符协议，如果实例字典中不存在该属性值，那么触发 `Non-Data descriptor` 的描述符协议**。

可能这讲完了，你还是不清楚和前面问题有什么关联，没事儿，我们接下来会讲讲 `property` 的实现

### 扩展（2）：Property 详解

首先我们来看看关于 Property 的实现

~~~Python
class Property(object):
    "Emulate PyProperty_Type() in Objects/descrobject.c"
    def __init__(self, fget=None, fset=None, fdel=None, doc=None):
        self.fget = fget
        self.fset = fset
        self.fdel = fdel
        if doc is None and fget is not None:
            doc = fget.__doc__
        self.__doc__ = doc

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        if self.fget is None:
            raise AttributeError("unreadable attribute")
        return self.fget(obj)

    def __set__(self, obj, value):
        if self.fset is None:
            raise AttributeError("can't set attribute")
        self.fset(obj, value)

    def __delete__(self, obj):
        if self.fdel is None:
            raise AttributeError("can't delete attribute")
        self.fdel(obj)

    def getter(self, fget):
        return type(self)(fget, self.fset, self.fdel, self.__doc__)

    def setter(self, fset):
        return type(self)(self.fget, fset, self.fdel, self.__doc__)

    def deleter(self, fdel):
        return type(self)(self.fget, self.fset, fdel, self.__doc__)
~~~

当我们执行完这两句语句时

~~~Python
x = _property(_itemgetter(0), doc='Alias for field number 0')

y = _property(_itemgetter(1), doc='Alias for field number 1')
~~~

我们的 `x` 和 `y` 就变成了一个 `property` 对象的实例，它们也是一个描述符，还记得我们前面讲的么，当一个变量/成员成为一个描述符后，它将改变正常的调用逻辑，现在当我们 `a.x=1` 的时候，因为我们的x是一个 **Data descriptors** ，那么不管我们的实例字典中是否有 `x` 的存在，我们都会触发其 `__set__` 方法，由于在我们初始化 `x` 和 `y` 两个变量时，没有给予其传入 `fset` 的方法，因此，我们 `__set__` 方法在运行过程中将会抛出 `AttributeError("can't set attribute")` 的异常，这也保证了 `namedtuple` 遵循了 `tuple` 的 **immutable** 的特性！是不是很优美！Amazing！

# 吐槽向

其实很多人不知道我为什么选择 `namedtuple` 来作为本期的主题，其实很简单呀，`namedtuple` 中预定义模板，格式化，然后用 `exec` 函数进行执行这一套方法，是目前 Python 中主流模板引擎的核心原理。某种意义上讲，你在吃透这一点后，你也掌握了怎样去实现一个简易模板引擎的方法，如果大家有兴趣，我们可以下次一起来写一个简单的模板引擎。还有就是在 `namedtuple` 对于 Python 中的一些高阶特性使用的简直优美无比，这也是我们学习的好例子。

最后的最后，作为另一个写的非常优美的例子，我将 `orderdict` 的代码贴出来，大家可以下来看看，然后评论区我们讨论一个！

~~~Python
class OrderedDict(dict):
    'Dictionary that remembers insertion order'
    # An inherited dict maps keys to values.
    # The inherited dict provides __getitem__, __len__, __contains__, and get.
    # The remaining methods are order-aware.
    # Big-O running times for all methods are the same as regular dictionaries.

    # The internal self.__map dict maps keys to links in a doubly linked list.
    # The circular doubly linked list starts and ends with a sentinel element.
    # The sentinel element never gets deleted (this simplifies the algorithm).
    # Each link is stored as a list of length three:  [PREV, NEXT, KEY].

    def __init__(*args, **kwds):
        '''Initialize an ordered dictionary.  The signature is the same as
        regular dictionaries, but keyword arguments are not recommended because
        their insertion order is arbitrary.

        '''
        if not args:
            raise TypeError("descriptor '__init__' of 'OrderedDict' object "
                            "needs an argument")
        self = args[0]
        args = args[1:]
        if len(args) > 1:
            raise TypeError('expected at most 1 arguments, got %d' % len(args))
        try:
            self.__root
        except AttributeError:
            self.__root = root = []                     # sentinel node
            root[:] = [root, root, None]
            self.__map = {}
        self.__update(*args, **kwds)

    def __setitem__(self, key, value, dict_setitem=dict.__setitem__):
        'od.__setitem__(i, y) <==> od[i]=y'
        # Setting a new item creates a new link at the end of the linked list,
        # and the inherited dictionary is updated with the new key/value pair.
        if key not in self:
            root = self.__root
            last = root[0]
            last[1] = root[0] = self.__map[key] = [last, root, key]
        return dict_setitem(self, key, value)

    def __delitem__(self, key, dict_delitem=dict.__delitem__):
        'od.__delitem__(y) <==> del od[y]'
        # Deleting an existing item uses self.__map to find the link which gets
        # removed by updating the links in the predecessor and successor nodes.
        dict_delitem(self, key)
        link_prev, link_next, _ = self.__map.pop(key)
        link_prev[1] = link_next                        # update link_prev[NEXT]
        link_next[0] = link_prev                        # update link_next[PREV]

    def __iter__(self):
        'od.__iter__() <==> iter(od)'
        # Traverse the linked list in order.
        root = self.__root
        curr = root[1]                                  # start at the first node
        while curr is not root:
            yield curr[2]                               # yield the curr[KEY]
            curr = curr[1]                              # move to next node

    def __reversed__(self):
        'od.__reversed__() <==> reversed(od)'
        # Traverse the linked list in reverse order.
        root = self.__root
        curr = root[0]                                  # start at the last node
        while curr is not root:
            yield curr[2]                               # yield the curr[KEY]
            curr = curr[0]                              # move to previous node

    def clear(self):
        'od.clear() -> None.  Remove all items from od.'
        root = self.__root
        root[:] = [root, root, None]
        self.__map.clear()
        dict.clear(self)

    # -- the following methods do not depend on the internal structure --

    def keys(self):
        'od.keys() -> list of keys in od'
        return list(self)

    def values(self):
        'od.values() -> list of values in od'
        return [self[key] for key in self]

    def items(self):
        'od.items() -> list of (key, value) pairs in od'
        return [(key, self[key]) for key in self]

    def iterkeys(self):
        'od.iterkeys() -> an iterator over the keys in od'
        return iter(self)

    def itervalues(self):
        'od.itervalues -> an iterator over the values in od'
        for k in self:
            yield self[k]

    def iteritems(self):
        'od.iteritems -> an iterator over the (key, value) pairs in od'
        for k in self:
            yield (k, self[k])

    update = MutableMapping.update

    __update = update # let subclasses override update without breaking __init__

    __marker = object()

    def pop(self, key, default=__marker):
        '''od.pop(k[,d]) -> v, remove specified key and return the corresponding
        value.  If key is not found, d is returned if given, otherwise KeyError
        is raised.

        '''
        if key in self:
            result = self[key]
            del self[key]
            return result
        if default is self.__marker:
            raise KeyError(key)
        return default

    def setdefault(self, key, default=None):
        'od.setdefault(k[,d]) -> od.get(k,d), also set od[k]=d if k not in od'
        if key in self:
            return self[key]
        self[key] = default
        return default

    def popitem(self, last=True):
        '''od.popitem() -> (k, v), return and remove a (key, value) pair.
        Pairs are returned in LIFO order if last is true or FIFO order if false.

        '''
        if not self:
            raise KeyError('dictionary is empty')
        key = next(reversed(self) if last else iter(self))
        value = self.pop(key)
        return key, value

    def __repr__(self, _repr_running={}):
        'od.__repr__() <==> repr(od)'
        call_key = id(self), _get_ident()
        if call_key in _repr_running:
            return '...'
        _repr_running[call_key] = 1
        try:
            if not self:
                return '%s()' % (self.__class__.__name__,)
            return '%s(%r)' % (self.__class__.__name__, self.items())
        finally:
            del _repr_running[call_key]

    def __reduce__(self):
        'Return state information for pickling'
        items = [[k, self[k]] for k in self]
        inst_dict = vars(self).copy()
        for k in vars(OrderedDict()):
            inst_dict.pop(k, None)
        if inst_dict:
            return (self.__class__, (items,), inst_dict)
        return self.__class__, (items,)

    def copy(self):
        'od.copy() -> a shallow copy of od'
        return self.__class__(self)

    @classmethod
    def fromkeys(cls, iterable, value=None):
        '''OD.fromkeys(S[, v]) -> New ordered dictionary with keys from S.
        If not specified, the value defaults to None.

        '''
        self = cls()
        for key in iterable:
            self[key] = value
        return self

    def __eq__(self, other):
        '''od.__eq__(y) <==> od==y.  Comparison to another OD is order-sensitive
        while comparison to a regular mapping is order-insensitive.

        '''
        if isinstance(other, OrderedDict):
            return dict.__eq__(self, other) and all(_imap(_eq, self, other))
        return dict.__eq__(self, other)

    def __ne__(self, other):
        'od.__ne__(y) <==> od!=y'
        return not self == other

    # -- the following methods support python 3.x style dictionary views --

    def viewkeys(self):
        "od.viewkeys() -> a set-like object providing a view on od's keys"
        return KeysView(self)

    def viewvalues(self):
        "od.viewvalues() -> an object providing a view on od's values"
        return ValuesView(self)

    def viewitems(self):
        "od.viewitems() -> a set-like object providing a view on od's items"
        return ItemsView(self)
~~~

# 参考目录
- [Descriptor HowTo Guide](https://docs.python.org/3/howto/descriptor.html)
- [Python 描述符入门指北](http://manjusaka.itscoder.com/2016/10/12/Something-about-Descriptor/)
- [collections](https://docs.python.org/3/library/collections.html?highlight=namedtuple)
