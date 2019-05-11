---
title: Sanic 的若干吐槽
type: tags
date: 2018-02-23 02:54:24
tags: [Python,编程,Flask,源码阅读]
categories: [编程,Python]
---

# Sanic 的若干吐槽

刚刚和红姐，在 [哪些 Python 库让你相见恨晚？](https://www.zhihu.com/question/24590883/answer/286407918) 这个答案下面讨论了一下 Sanic 的优劣。

突然想起，我司算是国内应该比较少见的把 Sanic 用在正式生产线上的公司了，作为一个主力推（da）动（shui）者（bi），我这个辣鸡文档工程师觉得有必要来说一下我们在使用 Sanic 过程中所采用的一系列深坑。

<!-- more -->

## 正文

首先 [Sanic 官方](http://sanic.readthedocs.io/en/latest/) 的口号是一个 **Flask Like** 的 web framework 。这回让很多人有一种错觉，就是 Sanic 内部的实现和 Flask 近乎一致，但是事实真的是这样么？

我们首先来看一下一组 Hello World 

~~~Python
# Flask

from flask import Flask
app = Flask(__name__)

@app.route('/')
def hello_world():
    return 'Hello World!'

if __name__ == '__main__':
    app.run()

~~~

~~~Python

# Sanic

from sanic import Sanic

app = Sanic()

@app.route("/")
async def hello_world(request):
    return "Hello World!"

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)

~~~

大家有没有发现什么不同之处？嗯？是不是 Sanic 的 View 函数多了一个参数是为什么呢？

Flask 众所周知的一个最典型的 Feature 就是，它有个 Global Variable 的概念，比如全局的 g 变量，以及 request 变量，这个是借助 werkzurg 里面独立实现的一套类似于 Thread.Local 的机制。在一个请求周期内，在我们业务逻辑，我们可以通过 `from flask import request` 来获取当前的 `request` 变量。我们也可以通过这样的机制，在上面挂一些数据来实现数据的全局使用。

但是 Sanic 则没有这个 Global Variable  这个概念，也就是说，我们需要在业务逻辑中使用 `request` 变量的话，就需要不断的传递一个 `request` 变量，直到一个请求周期的终结。

这样方式处理，有好，也有坏，不过我们的吐槽刚刚开始

## 坑点一：扩展极为不方便

比如，我们现在有个需求，我们需要写一个插件，提供给其余部门的同事使用，在插件中，我们需要给原本的 `Request` 类以及 `Response` 类新增一些功能，在 Flask 中我们可以这么做

~~~Python
from flask import Request,Response
from flask import Flask

class APIRequest(Request):
    pass
class APIResponse(Response):
    pass

class NewFlask(Flask):
    request_class = APIRequest
    response_class = APIResponse
~~~

Flask 中可以通过设置 `Flask` 类中的两个属性 `request_class` 以及 `response_class` 来替换原本的  `Request` 类，以及 `Response` 类。

就如同上面这段代码一样，我们很轻松的就可以为 `Request` 以及 `Response` 添加一些额外的功能。

但是在 Sanic 中呢？很蛋疼

~~~Python
class Sanic:

    def __init__(self, name=None, router=None, error_handler=None,
                 load_env=True, request_class=None,
                 strict_slashes=False, log_config=None,
                 configure_logging=True):

        # Get name from previous stack frame
        if name is None:
            frame_records = stack()[1]
            name = getmodulename(frame_records[1])

        # logging
        if configure_logging:
            logging.config.dictConfig(log_config or LOGGING_CONFIG_DEFAULTS)

        self.name = name
        self.router = router or Router()
        self.request_class = request_class
        self.error_handler = error_handler or ErrorHandler()
        self.config = Config(load_env=load_env)
        self.request_middleware = deque()
        self.response_middleware = deque()
        self.blueprints = {}
        self._blueprint_order = []
        self.configure_logging = configure_logging
        self.debug = None
        self.sock = None
        self.strict_slashes = strict_slashes
        self.listeners = defaultdict(list)
        self.is_running = False
        self.is_request_stream = False
        self.websocket_enabled = False
        self.websocket_tasks = set()

        # Register alternative method names
        self.go_fast = self.run
~~~ 

这是 Sanic 中 `Sanic` 类的初始化代码，首先在 `Sanic` 中，我们没办法很轻松的替换 `Response` ,其次，我们通过查看其 `__init__` 方法，我们就可以知道，如果要替换默认的 `Request` 我们需要给其初始化的时候传递一个参数 `request_class`。这就是让人感觉很迷的地方，这个东西，怎么可以让用传入呢？

诚然我们可以通过重载 `Sanic` 类的 `__init__` 方法，修改其默认的参数来解决这个问题。

但是新的问题也来了，我一直觉得写组件要默认一个假设，就是所有用你东西的人，智商emmmm都不太高。

好了，因为我们是提供的是插件，如果用户在使用的时候重新继承了我们的定制的 `Sanic` 类，同时没有使用 `super` 调用我们魔改后的 `__init__` 方法。那么这个时候，就会出一些很有趣的乱子。

同时，Sanic 内部耦合严重，也会造成我们构建插件的时候的困难。

## 坑点二: 内部耦合严重

现在，我们写插件，想在生成 `Response` 的时候进行一些额外的处理，在 Flask 中，我们可以这样做

~~~Python
from flask import Flask

class NewFlask(Flask):
    def make_response(self):
        pass

~~~ 

我们直接可以重载 `Flask` 类中的 `make_response` 方法来完成我们 `Response` 生成的时候新增的一些额外操作。

这个看似简单的操作，在 Sanic 中就变得很恶心

Sanic 中没有像 Flask 这样，一个请求周期内的不同阶段的数据流的处理有着各自独立的方法，比如 `dispatch_request`,`after_request` , `teardown_request` 等等，Request 的处理和 Response 的处理也有着很清晰的界限，我们按需重载就好

Sanic 将一个请求周期类的 `Request` 数据和 `Response` 数据的处理，都统一包裹在一个大的 `handle_request` 方法内

~~~Python

class Sanic:
    #.....
        async def handle_request(self, request, write_callback, stream_callback):
        """Take a request from the HTTP Server and return a response object
        to be sent back The HTTP Server only expects a response object, so
        exception handling must be done here

        :param request: HTTP Request object
        :param write_callback: Synchronous response function to be
            called with the response as the only argument
        :param stream_callback: Coroutine that handles streaming a
            StreamingHTTPResponse if produced by the handler.

        :return: Nothing
        """
        try:
            # -------------------------------------------- #
            # Request Middleware
            # -------------------------------------------- #

            request.app = self
            response = await self._run_request_middleware(request)
            # No middleware results
            if not response:
                # -------------------------------------------- #
                # Execute Handler
                # -------------------------------------------- #

                # Fetch handler from router
                handler, args, kwargs, uri = self.router.get(request)
                request.uri_template = uri
                if handler is None:
                    raise ServerError(
                        ("'None' was returned while requesting a "
                         "handler from the router"))

                # Run response handler
                response = handler(request, *args, **kwargs)
                if isawaitable(response):
                    response = await response
        except Exception as e:
            # -------------------------------------------- #
            # Response Generation Failed
            # -------------------------------------------- #

            try:
                response = self.error_handler.response(request, e)
                if isawaitable(response):
                    response = await response
            except Exception as e:
                if self.debug:
                    response = HTTPResponse(
                        "Error while handling error: {}\nStack: {}".format(
                            e, format_exc()))
                else:
                    response = HTTPResponse(
                        "An error occurred while handling an error")
        finally:
            # -------------------------------------------- #
            # Response Middleware
            # -------------------------------------------- #
            try:
                response = await self._run_response_middleware(request,
                                                               response)
            except BaseException:
                error_logger.exception(
                    'Exception occurred in one of response middleware handlers'
                )

        # pass the response to the correct callback
        if isinstance(response, StreamingHTTPResponse):
            await stream_callback(response)
        else:
            write_callback(response)
~~~

这就造成了一个现象，我们只需要对于某一个阶段数据进行额外的操作的时候，我们势必要重载 `handle_request` 这个大方法。就比如前面说的，我们只需要在 `Response` 生成的时候，进行一些额外操作，在 Flask 中我们只需要重载对应的 `make_response` 方法即可，而在 `Sanic` 中我们需要重载整个 `handle_request` 。可谓牵一发动全身。

同时，Sanic 不像 Flask 一样，做到了 WSGI 层的请求处理和 Framework 层的逻辑相互分离。这样一种分离，有时会给我们带来很多方便。

比如我之前写过这样一篇辣鸡文章[你所不知道的 Flask Part1:Route 初探](https://zhuanlan.zhihu.com/p/28540965)，里面提到了这样一个场景。

之前遇到一个很奇怪的需求，需要在flask中支持正则表达式比如，`@app.route('/api/(.*?)')`

这样，在视图函数被调用的时候，能传入 URL 中正则匹配的值。不过 Flask 路由中默认不支持这样的方法，那么我们该怎么办？

解决方案很简单

~~~Python

from flask import Flask
from werkzeug.routing import BaseConverter
class RegexConverter(BaseConverter):
    def __init__(self, map, *args):
        self.map = map
        self.regex = args[0]


app = Flask(__name__)
app.url_map.converters['regex'] = RegexConverter

~~~

在经过这样的设置后我们便可以按照我们刚才的需求写代码了

~~~Python
@app.route('/docs/model_utils/<regex(".*"):url>')
def hello(url=None):

    print(url)
~~~

大家可以看到，由于 Flask 的 WSGI 层的处理是基于 Werkzurg 来做的，也就是说，我们有些时候对于 `URL` 或者其余涉及到 `WSGI` 层的东西的时候，我们只需要重载/使用 Werkzurg 给我们提供的相关的类或者函数就可以了。同时 `app.url_map.converters['regex'] = RegexConverter` 这个操作，看了源码的同学就知道，`url_map` 这个是 `werkzurg.routing` 类中的 `Map` 类的一个子类，我们对它的操作，其实本质上也是对于 Werkzurg 的操作，而与 Flask 的框架逻辑无关。

但是在 Sanic 中，并没有这样的分离机制，比如就上面这个场景而言

~~~Python
class Sanic:

    def __init__(self, name=None, router=None, error_handler=None,
                 load_env=True, request_class=None,
                 strict_slashes=False, log_config=None,
                 configure_logging=True):
        #....
        self.router = router or Router()
        #....

~~~

Sanic 中对 URL 的解析是由 `Router()` 实例来触发的，我们如果需要定制我们自己的 URL 解析，我们需要替换 `self.router` ，这实际上是对 Sanic 本身进行了修改，感觉略有不妥。

同时这里的 `Router` 类中，如果我们需要定制自己的解析，需要重载 Router 中的

~~~Python

class Router:
    routes_static = None
    routes_dynamic = None
    routes_always_check = None
    parameter_pattern = re.compile(r'<(.+?)>')

~~~

`parameter_pattern` 属性及其余几个解析方法。这里的 Router 并没有像 Werkzurg 中的 Router 一样，实现 `Route` 和 `Parser` 以及 `Forammter`（就是 Converter) 彼此相互分离的特性，我们只需要按需重构添加即可，如同文中所举的例子。


整个这一部分，其实就在吐槽，Sanic 内部耦合严重，如果想实现一些额外的操作，可以说牵一发动全身。

## 坑点三：细节以及其余的坑

这一部分大概有几方面要说。

第一，Sanic 依赖的库，其实，emmmmmm，不太稳定，比如 10 月份的时候，触发了一个 bug ，其所依赖的 `ujson` 在序列化一些特定数据的时候，会抛出异常，这个问题，14年就已经爆出来了，不过到目前没修，2333333，同时当时的版本，如果要使用内置的函数的话，是不可以让用户选择具体的 parser 的，具体可以参考当时我提的 [PR](https://github.com/channelcat/sanic/pull/924)

第二，Sanic 一些东西实现的并不严谨，比如这篇文章有吐槽过[日常辣鸡水文:一个关于 Sanic 的小问题的思考](https://zhuanlan.zhihu.com/p/28930188)

第三，Sanic 现在不支持 UWSGI ，同时和 Gunicorn 配合部署的话，是自己实现了一套 Gunicorn Worker ，在我们生产环境下，会有一些诸如未知原因 504 这样的玄学 BUG，不过我们还在追查（另外有消息声称，Sanic 的 Server 部分并不严格遵守 [PEP333](https://www.python.org/dev/peps/pep-0333/)即 WSGI 协议，= =我改天核查一下）


# 总结

Sanic 的性能的确很棒，当时技术验证时，测试的时候，不同业务逻辑下，基本都能保证其性能在 Flask 的 1.5 倍以上。但是就目前的使用经验来说 Sanic 距离真正生产可用，还有相当长一段路要走。无论是内部的架构，还是周边的生态，亦或者是其他。大家可以没事拿来玩玩，但是如果要上生产线，请做好被坑的准备。

最后祝大家新年快乐，Live Long And Prosper!