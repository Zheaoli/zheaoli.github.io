---
title: 你所不知道的 Flask Part1:Route 初探
type: tags
date: 2017-08-13 19:01:29
tags: [Python,编程,Flask,源码阅读]
categories: [编程,Python]
---

## 前言

我自己都记不清楚上一次写博客是什么时候了（笑），上一次挖的坑现在还没填完，干脆，开个新坑吧，你不知道的 Flask ，记录下自己用 Flask 过程中一些很好玩的东西，当然很大可能我又会中途弃坑

## 开篇

### 引子

之前遇到一个很奇怪的需求，需要在flask中支持正则表达式比如，`@app.route('/api/(.*?)')` 这样，在视图函数被调用的时候，能传入 URL 中正则匹配的值。不过 Flask 路由中默认不支持这样的方法，那么我们该怎么办？我们先思考五分钟吧？

好了，我先给出解决方案吧

~~~python
from flask import Flask
from werkzeug.routing import BaseConverter
class RegexConverter(BaseConverter):
    def __init__(self, map, *args):
        self.map = map
        self.regex = args[0]


app = Flask(__name__)
app.url_map.converters['regex'] = RegexConverter
~~~
<!--more-->
在经过这样的设置后我们便可以按照我们刚才的需求写代码了

~~~python

@app.route('/docs/model_utils/<regex(".*"):url>')
def hello(url=None):

    print(url)
~~~

在这里，我们函数中传入的url变量，就是我们代码中所匹配到的值 

但是为什么这样就OK了呢？

### 详解

首先，我们要弄清楚一个东西，Flask 是 基于 Werkzurg 的一个框架，Flask 的 Route 机制基于 Werkzurg 上更进一步封装所得到的，OK，我们上面所以实现的 Converter 便是利用了 Werkzurg 中的 Route 的特性

好了，我先给出官方文档 [custom-converters](http://werkzeug.pocoo.org/docs/0.12/routing/#custom-converters) 

然后我们来仔细讲讲，

首先，Werkzurg 中存在着一种机制叫做 Converter ，简而言之就是通过一定的特殊语法，将 URL 中的特定部分，转化成特定的 Python 变量，其语法格式为 `/url/<converter_name("表达式"):变量名>` 看起来有点复杂对吧，OK 用我们之前的例子来讲一下吧，你看，我们之前定义了一个 `'/docs/model_utils/<regex(".*"):url>'` 的 URL ，其中后面部分就是利用了我们提到的 Converter 语法。具体的含义是，这个部分的 url 交给 regex 这个 Converter 来处理，最终生成的变量名为 `url`。

好了，我们来说说自定义 Converter 参数中的注意事项，在构建一个自己的 Converter 过程中，我们将按照如下的方式编写代码

~~~python
class RegexConverter(BaseConverter):
    def __init__(self, map, regex,*args):
        self.map = map
        self.regex = regex
~~~

map 是指 werkzurg.routing 中的 Map 对象，而 regex 则是指你所写的表达式。其中 map 的作用我们将放在下一章进行讲解，（又立flag了，笑）。

好了这里差不多完成了，我们来看看 Flask 喔，不，werkzurg 中怎么实现的这样的方法吧

### 简明代码剖析

最前面，你首先得有一点 flask 装饰器路由的知识，详情可以参考这篇文章，[菜鸟阅读 Flask 源码系列（1）：Flask的router初探](http://manjusaka.itscoder.com/2016/08/09/reading-the-fucking-flask-source-code-Part1/)

首先在 werkzurg 框架的 routing 文件中，存在着这样一段代码

~~~python

_rule_re = re.compile(r'''
    (?P<static>[^<]*)                           # static rule data
    <
    (?:
        (?P<converter>[a-zA-Z_][a-zA-Z0-9_]*)   # converter name
        (?:\((?P<args>.*?)\))?                  # converter arguments
        \:                                      # variable delimiter
    )?
    (?P<variable>[a-zA-Z_][a-zA-Z0-9_]*)        # variable name
    >
''', re.VERBOSE)
_simple_rule_re = re.compile(r'<([^>]+)>')
_converter_args_re = re.compile(r'''
    ((?P<name>\w+)\s*=\s*)?
    (?P<value>
        True|False|
        \d+.\d+|
        \d+.|
        \d+|
        \w+|
        [urUR]?(?P<stringval>"[^"]*?"|'[^']*')
    )\s*,
''', re.VERBOSE | re.UNICODE)

def parse_converter_args(argstr):
    argstr += ','
    args = []
    kwargs = {}

    for item in _converter_args_re.finditer(argstr):
        value = item.group('stringval')
        if value is None:
            value = item.group('value')
        value = _pythonize(value)
        if not item.group('name'):
            args.append(value)
        else:
            name = item.group('name')
            kwargs[name] = value

    return tuple(args), kwargs


def parse_rule(rule):
    """Parse a rule and return it as generator. Each iteration yields tuples
    in the form ``(converter, arguments, variable)``. If the converter is
    `None` it's a static url part, otherwise it's a dynamic one.

    :internal:
    """
    pos = 0
    end = len(rule)
    do_match = _rule_re.match
    used_names = set()
    while pos < end:
        m = do_match(rule, pos)
        if m is None:
            break
        data = m.groupdict()
        if data['static']:
            yield None, None, data['static']
        variable = data['variable']
        converter = data['converter'] or 'default'
        if variable in used_names:
            raise ValueError('variable name %r used twice.' % variable)
        used_names.add(variable)
        yield converter, data['args'] or None, variable
        pos = m.end()
    if pos < end:
        remaining = rule[pos:]
        if '>' in remaining or '<' in remaining:
            raise ValueError('malformed url rule: %r' % rule)
        yield None, None, remaining
~~~

首先，`_rule_re` 以及 `_converter_args_re` 两段是很骚的正则表达式，不过作者已经给出了足够的注释，大家可以对照着正则表达式的语法进行学习一个，然后 `parse_converter_args` 以及 `parse_rule` 则是利用正则表达式对其进行解析操作。

OK，我们紧接着往下查看

~~~python

    def compile(self):
        """Compiles the regular expression and stores it."""
        assert self.map is not None, 'rule not bound'

        if self.map.host_matching:
            domain_rule = self.host or ''
        else:
            domain_rule = self.subdomain or ''

        self._trace = []
        self._converters = {}
        self._weights = []
        regex_parts = []

        def _build_regex(rule):
            for converter, arguments, variable in parse_rule(rule):
                if converter is None:
                    regex_parts.append(re.escape(variable))
                    self._trace.append((False, variable))
                    for part in variable.split('/'):
                        if part:
                            self._weights.append((0, -len(part)))
                else:
                    if arguments:
                        c_args, c_kwargs = parse_converter_args(arguments)
                    else:
                        c_args = ()
                        c_kwargs = {}
                    convobj = self.get_converter(
                        variable, converter, c_args, c_kwargs)
                    regex_parts.append('(?P<%s>%s)' % (variable, convobj.regex))
                    self._converters[variable] = convobj
                    self._trace.append((True, variable))
                    self._weights.append((1, convobj.weight))
                    self.arguments.add(str(variable))

        _build_regex(domain_rule)
        regex_parts.append('\\|')
        self._trace.append((False, '|'))
        _build_regex(self.is_leaf and self.rule or self.rule.rstrip('/'))
        if not self.is_leaf:
            self._trace.append((False, '/'))

        if self.build_only:
            return
        regex = r'^%s%s$' % (
            u''.join(regex_parts),
            (not self.is_leaf or not self.strict_slashes) and
            '(?<!/)(?P<__suffix__>/?)' or ''
        )
        self._regex = re.compile(regex, re.UNICODE)
~~~

这是 werkzurg 框架的 routing 文件中 Rule 类种的一部分的源码，其中在 `def _build_regex(rule):` 之前的是一些准备代码，然后我们接着往下看，`for converter, arguments, variable in parse_rule(rule):` 这一段代码，就是 URL 解析，通过调用 `parse_rule` 函数来实现对我们之前提到的 converter 语法进行解析，紧接着，如果 URL 里不存在我们 Converter 的语法，则 `converter` 为空，我们执行处理其余 URL 的逻辑，如果 `converter` 存在，进行下面的流程，首先，如果我们在 Converter 语法中设定了解析表达式，那么我们利用 `parse_converter_args` 函数来处理我们的表达式，方便后续的操作，处理完成后，我们利用 `get_converter` 方法来初始化我们的 Converter , 代码如下：

~~~python

    def get_converter(self, variable_name, converter_name, args, kwargs):
        """Looks up the converter for the given parameter.

        .. versionadded:: 0.9
        """
        if converter_name not in self.map.converters:
            raise LookupError('the converter %r does not exist' % converter_name)
        return self.map.converters[converter_name](self.map, *args, **kwargs)
~~~

以我们之前的 demo 为例，

~~~python
from flask import Flask
from werkzeug.routing import BaseConverter
class RegexConverter(BaseConverter):
    def __init__(self, map, *args):
        self.map = map
        self.regex = args[0]


app = Flask(__name__)
app.url_map.converters['regex'] = RegexConverter
~~~

我们已经添加了一个名为 `regex` 的 Converter 对象，在 `get_converter` 方法中我们传入了值为 `regex` 的 `converter_name` 变量，紧接着，我们初始化了一个 `RegexConverter` 对象的实例，然后返回这个实例

~~~python
    def compile(self):
        """Compiles the regular expression and stores it."""
        assert self.map is not None, 'rule not bound'

        if self.map.host_matching:
            domain_rule = self.host or ''
        else:
            domain_rule = self.subdomain or ''

        self._trace = []
        self._converters = {}
        self._weights = []
        regex_parts = []

        def _build_regex(rule):
            for converter, arguments, variable in parse_rule(rule):
                if converter is None:
                    regex_parts.append(re.escape(variable))
                    self._trace.append((False, variable))
                    for part in variable.split('/'):
                        if part:
                            self._weights.append((0, -len(part)))
                else:
                    if arguments:
                        c_args, c_kwargs = parse_converter_args(arguments)
                    else:
                        c_args = ()
                        c_kwargs = {}
                    convobj = self.get_converter(
                        variable, converter, c_args, c_kwargs)
############################################################# 无耻分割线
                    regex_parts.append('(?P<%s>%s)' % (variable, convobj.regex))
                    self._converters[variable] = convobj
                    self._trace.append((True, variable))
                    self._weights.append((1, convobj.weight))
                    self.arguments.add(str(variable))

        _build_regex(domain_rule)
        regex_parts.append('\\|')
        self._trace.append((False, '|'))
        _build_regex(self.is_leaf and self.rule or self.rule.rstrip('/'))
        if not self.is_leaf:
            self._trace.append((False, '/'))

        if self.build_only:
            return
        regex = r'^%s%s$' % (
            u''.join(regex_parts),
            (not self.is_leaf or not self.strict_slashes) and
            '(?<!/)(?P<__suffix__>/?)' or ''
        )
        self._regex = re.compile(regex, re.UNICODE)
~~~

在分割线后面的代码中，我们对处理后的 url 进行一些收尾的操作，以我们之前的 demo 为例，我们设定的 `/docs/model_utils/<regex(".*"):url>` URL 最终转化成 `/docs/model_utils/(?P<url>.*)` ，编译成 re 对象后赋值给 Rule 实例中的 _regex 变量

好了，我们知道处理的部分后，我们大致来看一下怎么匹配并生成值的吧

~~~python
    def match(self, path, method=None):
        """Check if the rule matches a given path. Path is a string in the
        form ``"subdomain|/path"`` and is assembled by the map.  If
        the map is doing host matching the subdomain part will be the host
        instead.

        If the rule matches a dict with the converted values is returned,
        otherwise the return value is `None`.

        :internal:
        """
        if not self.build_only:
            m = self._regex.search(path)
            if m is not None:
                groups = m.groupdict()
                # we have a folder like part of the url without a trailing
                # slash and strict slashes enabled. raise an exception that
                # tells the map to redirect to the same url but with a
                # trailing slash
                if self.strict_slashes and not self.is_leaf and \
                        not groups.pop('__suffix__') and \
                        (method is None or self.methods is None or
                         method in self.methods):
                    raise RequestSlash()
                # if we are not in strict slashes mode we have to remove
                # a __suffix__
                elif not self.strict_slashes:
                    del groups['__suffix__']

                result = {}
                for name, value in iteritems(groups):
                    try:
                        value = self._converters[name].to_python(value)
                    except ValidationError:
                        return
                    result[str(name)] = value
                if self.defaults:
                    result.update(self.defaults)

                if self.alias and self.map.redirect_defaults:
                    raise RequestAliasRedirect(result)

                return result
~~~

这也是 werkzurg 框架的 routing 文件中 Rule 类种的一部分的源码，在这段代码中，首先利用 re 对象中的 search 方法，检测当前传入的 Path 是否匹配，如果匹配的话，进入后续的处理流程，还记得我们之前最终生成的 `/docs/model_utils/(?P<url>.*)` 么，这里面利用了正则表达式命名组的语法糖，在这里，匹配成功后，Python 的 re 库里给我们提供了一个 `groupdict` 让我们取出命名组里所代表的值。然后我们调用 conveter 实例里面的 to_python 方法来对我们匹配出来的值进行处理（注：这是 Converter 系列对象中的一个可重载方法，我们可以通过重载这个方法，来对我们匹配到的值进行一些逻辑处理，这个我们还是后面再讲吧，flag++），然后我们把最终的 `result` 值返回。

最后的最后，Flask 在获取 werkzurg 给出的匹配结果后，将匹配的值，放在 `request` 实例中的 `view_args` 变量上，最后通过 `dispatch_request` 对象传递给我们的视图函数，代码如下

~~~python
    def dispatch_request(self):
        """Does the request dispatching.  Matches the URL and returns the
        return value of the view or error handler.  This does not have to
        be a response object.  In order to convert the return value to a
        proper response object, call :func:`make_response`.

        .. versionchanged:: 0.7
           This no longer does the exception handling, this code was
           moved to the new :meth:`full_dispatch_request`.
        """
        req = _request_ctx_stack.top.request
        if req.routing_exception is not None:
            self.raise_routing_exception(req)
        rule = req.url_rule
        # if we provide automatic options for this URL and the
        # request came with the OPTIONS method, reply automatically
        if getattr(rule, 'provide_automatic_options', False) \
           and req.method == 'OPTIONS':
            return self.make_default_options_response()
        # otherwise dispatch to the handler for that endpoint
        return self.view_functions[rule.endpoint](**req.view_args)
~~~

好了，我们的代码剖析就到此结束

## 最后想说几句

Flask + Werkzurg 是一套设计实现的非常精妙的组合，不过我们在日常的使用中常常忽略了里面的美丽的风景，所以这也是我想写这样剖析代码笔记的文章的原因

好了，给老铁们留几个思考题，欢迎评论区讨论

* Flask 为什么不默认支持正则表达式的输入

* 诸如 `PathConverter` 这样 Werkzurg 内置的 Converter 为什么在写表达式的时候可以这样 `/<path:wikipage>/edit` 写，而忽略其中的表达式

* 前面提到的 `parse_converter_args` 方法的代码详解

好了，就先这样吧2333

对了，保佑我文章里立的 Flag 都能实现（笑）