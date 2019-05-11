---
title: 日常辣鸡水文:一个关于 Sanic 的小问题的思考
type: tags
date: 2018-02-23 02:54:22
tags: [Python,编程,Flask,源码阅读]
categories: [编程,Python]
---

## 日常辣鸡水文:一个关于 Sanic 的小问题的思考

睡不着，作为一个 API 复制粘贴工程师来日常辣鸡水文一篇

### 正文

最近迁移组内代码到 Sanic ，遇到一个很有意思的情况

首先标准的套路应该是这样的

<!-- more -->

~~~python
from sanic import Sanic,reponse
app=Sanic(__name__)

def return_value(controller_fun):
    """
    返回参数的装饰器
    :param controller_fun:  控制层函数
    :return:
    """

    async def __decorator(*args, **kwargs):
        ret_value = {
            "version": server_current_config.version,
            "success": 0,
            "message": u"fail query"
        }
        ret_data, code = await controller_fun(*args, **kwargs)

        if is_blank(ret_data):
            ret_value["data"] = {}
        else:
            ret_value["success"] = 1
            ret_value["message"] = u"succ query"
            ret_value["data"] = ret_data
            ret_value["update_time"] = convert_time_to_time_str(get_now())
        print(ret_value)
        return response.json(body=ret_value, status=code)

    return __decorator

async def test1():
    return {"a":1"}
@return_value
async def test2():
    return await test1(),200



@app.route("/wtf")
async def test3():
    return await test2()
~~~

中规中举，没什么太大问题

不过如果上面的代码变成下面这样 

~~~python
from sanic import Sanic,reponse
app=Sanic(__name__)

async def test1():
    return {"a":1"}
@return_value
async def test2():
    return await test1()


@app.route("/wtf")
def test3():
    return test2()
~~~

一般会以为这样会产生报错的，因为没有 `await test2()` ，直接 `return test2()` 的话，返回的是一个 `Coroutine` 的对象，这样应该是会抛错的，但是实际上是正常运行的，最开始很迷，不过后面看了下 Sanic 中关于 `handle_request` 的部分，有点意思

~~~python
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
            except:
                log.exception(
                    'Exception occured in one of response middleware handlers'
                )

        # pass the response to the correct callback
        if isinstance(response, StreamingHTTPResponse):
            await stream_callback(response)
        else:
            write_callback(response)
~~~

核心代码是这样一段

~~~python
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
~~~

大概就是，首先按照 route->add_route 的顺序注册对应的处理函数和 **URL** 到一个映射里，然后当请求发过来时，取出对应的 `handler` ，然后进一步处理

最开始正常的中规中矩的做法里

~~~python
@app.route("/wtf")
async def test3():
    return await test2()
~~~

注册的 `handler` 是 `test3` 这个函数，然后执行 `response = handler(request, *args, **kwargs)` ，初始化了一个 `Coroutine` 对象，紧接着这个对象是 `awaitable` 的，于是进入后面的 `response = await response` 流程。

好了，来看看非主流的做法

~~~python
@app.route("/wtf")
def test3():
    return test2()
~~~

老规矩，先注册，然后取出 `test3` 这个函数作为 `handler` ，然后执行，因为是普通函数，于是 `response` 的值便是 `test3` 中初始化的那个 `Coroutine` 对象，然后同样是 `awaitable` 的，进入后面的 `response = await response` 流程。

两种方式殊途同归，这也解释了为什么第二中不清真的方式也能得到正确的结果

### 思考

Sanic 这样的处理方式，相当于增强了整个框架的容错性。也可能让用户写出向之前那样不清真的代码。不过我也没法说这个是好是坏，各有看法吧。不过有一点是肯定的，在 `debug` 模式下，如果用户利用 `app.route` 添加了一个非 `async` 的函数，是有必要抛出一个 warning 的，不过，Sanic 还有，PR 已经提出，就不知道合不合了。。。

好了，就先这样吧。。明天还得搬砖，溜了，溜了。。
