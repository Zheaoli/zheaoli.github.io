---
title: Flask 中的 Context 初探
type: tags
date: 2018-02-23 02:54:20
tags: [Python,编程,Flask,源码阅读]
categories: [编程,Python]
---

# Flask 中的 Context 初探

大家新年好！鉴于今年春晚非常好看，我觉得承受不起，于是来写点辣鸡水文娱乐下大家，这也是之前立的若干 Flag 中的一个

# 正文

做过 Flask 开发的朋友都知道 Flask 中存在着两个概念，一个叫 App Context , 一个叫 Request Context 。 这两个算是 Flask 中很独特的一种机制。

从一个 Flask App 读入配置并启动开始，就进入了 App Context，在其中我们可以访问配置文件、打开资源文件、通过路由规则反向构造 URL。当 WSGI Middleware 调用 Flask App 的时候开始，就进入了 Request Context 。我们可以获取到其中的 HTTP HEADER 等操作，同时也可以进行 SESSION 等操作。

不过作为辣鸡选手而言，经常分不清为什么会存在这两个 Context ，没事，我们慢慢来说一说。

<!-- more -->

## 预备知识

首先要清楚一点，我们要在同一个进程中隔离不同线程的数据，那么我们会优先选择 `threading.local` ，来实现数据彼此隔离的需求。但是现在有个问题来了，现在我们并发模型可能并不是只有传统意义上的**进程-线程**模型。也有可能是 **coroutine(协程)** 模型。常见的就是 Greenlet/Eventlet 。在这种情况下，`threading.local` 就没法很好的满足我们的需求。于是 **Werkzeug** 实现了自己的 Local 即 `werkzeug.local.Local`

那么 **Werkzeug** 自己实现的 Local 和标准的 `threading.local` 相比有什么不同呢？我们记住最大的不同点在于

> 前者会在 Greenlet 可用的情况下优先使用 Greenlet 的 ID 而不是线程 ID 以支持 Gevent 或 Eventlet 的调度，后者只支持多线程调度；

Werkzeug 另外还实现了两种数据结构，一个叫 `LocalStack` ，一个叫做 `LocalProxy` 

`LocalStack` 是基于 `Local` 实现的一个栈结构。栈的特性就是**后入先出**。当我们进入一个 Context 时，将当前的的对象推入栈中。然后我们也可以获取到栈顶元素。从而获取到当前的上下文信息。

`LocalProxy` 是代理模式的一种实现。在实例化的时候，传入一个 `callable` 的参数。然后这个参数被调用后将会返回一个 `Local` 对象。我们后续的所有操作，比如属性调用，数值计算等，都会转发到这个参数返回的 `Local` 对象上。

现在大家可能不太清楚，我们为什么要用 LocalProxy 来进行操作，我们来给大家看一个例子

~~~Python

from werkzeug.local import LocalStack
test_stack = LocalStack()
test_stack.push({'abc': '123'})
test_stack.push({'abc': '1234'})

def get_item():
    return test_stack.pop()

item = get_item()

print(item['abc'])
print(item['abc'])

~~~

你看我们这里的输出的的值，都是统一的 `1234` ，但是我们这里想做到的是每次获取的值都是栈顶的最新的元素，那么我们这个时候就应该用 proxy 模式了

~~~Python
from werkzeug.local import LocalStack, LocalProxy
test_stack = LocalStack()
test_stack.push({'abc': '123'})
test_stack.push({'abc': '1234'})

def get_item():
    return test_stack.pop()

item = LocalProxy(get_item)

print(item['abc'])
print(item['abc'])

~~~

你看我们这里就是 Proxy 的妙用。

## Context

由于 Flask 基于 Werkzeug 实现，因此 App Context 以及 Request Context 是基于前文中所说的 LocalStack 实现。

从命名上，大家应该可以看出，App Context 是代表应用上下文，可能包含各种配置信息，比如日志配置，数据库配置等。而 Request Context 代表一个请求上下文，我们可以获取到当前请求中的各种信息。比如 body 携带的信息。

这两个上下文的定义是在 **flask.ctx** 文件中，分别是 `AppContext` 以及 `RequestContext` 。而构建上下文的操作则是将其推入在 **flask.globals** 文件中定义的 `_app_ctx_stack` 以及 `_request_ctx_stack` 中。前面说了 LocalStack 是“线程”（这里可能是传统意义上的线程，也有可能是 Greenlet 这种）隔离的。同时 Flask 每个线程只处理一个请求，因此可以做到请求隔离。

当 `app = Flask(__name__)` 构造出一个 Flask App 时，App Context 并不会被自动推入 Stack 中。所以此时 Local Stack 的栈顶是空的，current_app 也是 unbound 状态。

~~~Python

from flask import Flask

from flask.globals import _app_ctx_stack, _request_ctx_stack

app = Flask(__name__)

_app_ctx_stack.top
_request_ctx_stack.top
_app_ctx_stack()
# <LocalProxy unbound>
from flask import current_app
current_app
# <LocalProxy unbound>
~~~

作为 web 时，当请求进来时，我们开始进行上下文的相关操作。整个流程如下：

![image](https://user-images.githubusercontent.com/7054676/36314635-675c086c-1370-11e8-87f1-819cb9f5f299.png)

好了现在有点问题：

1. 为什么要区分 App Context 以及 Request Context

2. 为什么要用栈结构来实现 Context ？

很久之前看过的松鼠奥利奥老师的博文[Flask 的 Context 机制](https://blog.tonyseek.com/post/the-context-mechanism-of-flask/) 解答了这个问题 

> 这两个做法给予我们 多个 Flask App 共存 和 非 Web Runtime 中灵活控制 Context 的可能性。

> 我们知道对一个 Flask App 调用 app.run() 之后，进程就进入阻塞模式并开始监听请求。此时是不可能再让另一个 Flask App 在主线程运行起来的。那么还有哪些场景需要多个 Flask App 共存呢？前面提到了，一个 Flask App 实例就是一个 WSGI Application，那么 WSGI Middleware 是允许使用组合模式的，比如：

~~~Python

from werkzeug.wsgi import DispatcherMiddleware
from biubiu.app import create_app
from biubiu.admin.app import create_app as create_admin_app

application = DispatcherMiddleware(create_app(), {
    '/admin': create_admin_app()
})

~~~

奥利奥老师文中举了一个这样一个例子，Werkzeug 内置的 Middleware 将两个 Flask App 组合成一个一个 WSGI Application。这种情况下两个 App 都同时在运行，只是根据 URL 的不同而将请求分发到不同的 App 上处理。

但是现在很多朋友有个问题，就是为什么这里不用 Blueprint ？

* Blueprint 是在同一个 App 下运行。其挂在 App Context 上的相关信息都是一致的。但是如果要隔离彼此的信息的话，那么用 App Context 进行隔离，会比我们用变量名什么的隔离更为方便

* Middleware 模式是 WSGI 中允许的特性，换句话来讲，我们将 Flask 和另外一个遵循 WSGI 协议的 web Framework （比如 Django）那么也是可行的。

但是 Flask 的两种 Context 分离更大的意义是为了非 web 应用的场合。Flask 官方文档中有这样一段话

> The main reason for the application’s context existence is that in the past a bunch of functionality was attached to the request context for lack of a better solution. Since one of the pillars of Flask’s design is that you can have more than one application in the same Python process.

这句话换句话说 App Context 存在的意义是针对一个进程中有多个 Flask App 场景，这样场景最常见的就是我们用 Flask 来做一些离线脚本的代码。

好了，我们来聊聊 Flask 非 Web 应用的场景

比如，我们有个插件叫 Flask-SQLAlchemy 
然后这里有个使用场景
首先我们现在有这样一个代码

~~~Python
from flask import Flask
from flask_sqlalchemy import SQLAlchemy

database = Flask(__name__)
database.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:////tmp/test.db'
db = SQLAlchemy(database)


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)

    def __repr__(self):
        return '<User %r>' % self.username
~~~

这里你应该注意到最开始的几个关键点，第一个，就是 `database.config`  ，是的没错，Flask-SQLAlchemy 就是从当前的 app 中获取到对应的 config 信息来建立数据库链接。那么传递 app 的方式有两种，第一种，就是直接如上图一样，直接 db = SQLAlchemy(database) ，这个很容易理解，第二种，如果我们不传的话，那么 Flask-SQLAlchemy 中通过 current_app 来获取当前的 app 然后获取对应的 config 建立链接。
那么问题来了，为什么会存在第二种这种方法呢

给个场景吧，现在我两个数据库配置不同的 app 共用一个  Model 那么应该怎么做？其实很简单

首先写 一个 model 文件，比如就叫 data/user_model.py 吧

~~~Python
from flask_sqlalchemy import SQLAlchemy
db = SQLAlchemy()


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)

    def __repr__(self):
        return '<User %r>' % self.username
~~~

好了，那么在我们的应用文件中，我们便可以这样写

~~~Python
from data.user_model import User
database = Flask(__name__)
database.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:////tmp/test.db'
with database.app_context():
    db.init_app(current_app)
    db.create_all()
    admin = User(username='admin', email='admin@example.com')
    db.session.add(admin)
    db.session.commit()
    print(User.query.filter_by(username="admin").first())

database1 = Flask(__name__)
database1.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:////tmp/test1.db'
with database1.app_context():
    db.init_app(current_app)
    db.create_all()
    admin = User(username='admin_test', email='admin@example.com')
    db.session.add(admin)
    db.session.commit()
    print(User.query.filter_by(username="admin").first())
~~~

你看这样是不是就好懂了一些，通过 app context ，我们  Flask-SQLAlchemy 可以通过 current_app 来获取当前 app ，继而获取相关的 config 信息

这个例子还不够妥当，我们现在再来换一个例子

~~~Python
from flask import Flask, current_app
import logging

app = Flask("app1")
app2 = Flask("app2")

app.config.logger = logging.getLogger("app1.logger")
app2.config.logger = logging.getLogger("app2.logger")

app.logger.addHandler(logging.FileHandler("app_log.txt"))
app2.logger.addHandler(logging.FileHandler("app2_log.txt"))

with app.app_context():
    with app2.app_context():
        try:
            raise ValueError("app2 error")
        except Exception as e:
            current_app.config.logger.exception(e)
    try:
        raise ValueError("app1 error")
    except Exception as e:
        current_app.config.logger.exception(e)
~~~

好了，这段代码很清晰了，含义很清晰，就是通过获取当前上下文中的 app 中的 logger 来输出日志。同时这段代码也很清晰的说明了，我们为什么要用栈这样一种数据结构来维护上下文。

首先看一下 `app_context()` 的源码

~~~Python

    def app_context(self):
        """Binds the application only.  For as long as the application is bound
        to the current context the :data:`flask.current_app` points to that
        application.  An application context is automatically created when a
        request context is pushed if necessary.

        Example usage::

            with app.app_context():
                ...

        .. versionadded:: 0.9
        """
        return AppContext(self)
~~~

嗯，很简单，只是构建一个 AppContext 对象返回，然后我们看看相关的代码

~~~Python

class AppContext(object):
    """The application context binds an application object implicitly
    to the current thread or greenlet, similar to how the
    :class:`RequestContext` binds request information.  The application
    context is also implicitly created if a request context is created
    but the application is not on top of the individual application
    context.
    """

    def __init__(self, app):
        self.app = app
        self.url_adapter = app.create_url_adapter(None)
        self.g = app.app_ctx_globals_class()

        # Like request context, app contexts can be pushed multiple times
        # but there a basic "refcount" is enough to track them.
        self._refcnt = 0

    def push(self):
        """Binds the app context to the current context."""
        self._refcnt += 1
        if hasattr(sys, 'exc_clear'):
            sys.exc_clear()
        _app_ctx_stack.push(self)
        appcontext_pushed.send(self.app)

    def pop(self, exc=_sentinel):
        """Pops the app context."""
        try:
            self._refcnt -= 1
            if self._refcnt <= 0:
                if exc is _sentinel:
                    exc = sys.exc_info()[1]
                self.app.do_teardown_appcontext(exc)
        finally:
            rv = _app_ctx_stack.pop()
        assert rv is self, 'Popped wrong app context.  (%r instead of %r)' \
            % (rv, self)
        appcontext_popped.send(self.app)

    def __enter__(self):
        self.push()
        return self

    def __exit__(self, exc_type, exc_value, tb):
        self.pop(exc_value)

        if BROKEN_PYPY_CTXMGR_EXIT and exc_type is not None:
            reraise(exc_type, exc_value, tb)
~~~

emmmm，首先 `push` 方法就是将自己推入 `_app_ctx_stack` ，而 `pop` 方法则是将自己从栈顶推出。然后我们看到两个方法含义就很明确了，在进入上下文管理器的时候，将自己推入栈，然后退出上下文管理器的时候，将自己推出。

我们都知道栈的一个性质就是，后入先出，栈顶的永远是最新插入进去的元素。而看一下我们 `current_app` 的源码

~~~Python

def _find_app():
    top = _app_ctx_stack.top
    if top is None:
        raise RuntimeError(_app_ctx_err_msg)
    return top.app
    
current_app = LocalProxy(_find_app)

~~~

嗯，很明了了，就是获取当前栈顶的元素，然后进行相关操作。

嗯，通过这样对于栈的不断操作，就能让 `current_app` 获取到元素是我们当前上下文中的 app 。

## 额外的讲解: g

g 也是我们常用的几个全局变量之一。在最开始这个变量是挂载在 Request Context 下的。但是在 0.10 以后，g 就是挂载在 App Context 下的。可能有同学不太清楚为什么要这么做。

首先，说一下 g 用来干什么

官方在上下文这一张里有这一段说明

> The application context is created and destroyed as necessary. It never moves between threads and it will not be shared between requests. As such it is the perfect place to store database connection information and other things. The internal stack object is called flask._app_ctx_stack. Extensions are free to store additional information on the topmost level, assuming they pick a sufficiently unique name and should put their information there, instead of on the flask.g object which is reserved for user code.

大意就是说，数据库配置和其余的重要配置信息，就挂载 App 对象上。但是如果是一些用户代码，比如你不想一层层函数传数据的话，然后有一些变量需要传递，那么可以挂在 g 上。

同时前面说了，Flask 并不仅仅可以当做一个 Web Framework 使用，同时也可以用于一些非 web 的场合下。在这种情况下，如果 g 是属于 Request Context 的话，那么我们要使用 g 的话，那么就需要手动构建一个请求，这无疑是不合理的。

## 最后

大年三十写这篇文章，现在发出来，我的辣鸡也是无人可救了。Flask 的上下文机制是其最重要的特性之一。通过合理的利用上下文机制，我们可以再更多的场合下去更好的利用 flask 。嗯，本次的辣鸡文章写作活动就到此结束吧。希望大家不会扔我臭鸡蛋！然后新年快乐！
