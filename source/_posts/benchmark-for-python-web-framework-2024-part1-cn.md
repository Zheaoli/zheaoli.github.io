---
title: 2024 年了，是 Gevent 还是选择 asyncio Part 1？
type: tags
date: 2024-08-20 01:00:00
tags: [编程,CPython,笔记,水文]
categories: [编程,CPython]
toc: true
---

Gevent 还是 asyncio 这一直是个经典的问题，在这里我们直接用数据来帮助大家做一下决策

<!--more-->

## 开篇

Lin Wei 老师珠玉在前

![HiRedis](https://i.imgur.com/Jk2ubDY.png)

给出了 asyncio 和 Gevnet 的极限性能。 在这里我们看到了 asyncio 配合 uvloop 基本上是 Gevent 的 double 了

那么在在 Web 框架下是否如此呢？

我们来做一下实验吧

首先说一下负载机器的配置，这里我选用了 Azure 上 D8as_v5 的机器，该机器配置如下：

1. 8Core32G 的配置
2. 底座硬件基于 EPYC 7763 系列处理器
3. 共计4个节点，分配给 Django/Flast/FastAPI/Starlette 四个不同的框架

我们压测框架选择 locust，同样基于 Kuberntes 集群，因为我账户的 D8as_v5 机器的 Quota 不太够，所以压测框架我们选了不同机器的混合部署

1. 4个 D8as_v5，共计 32 Core 算力
2. 4个 D8as_v3，共计 32 Core 算力
3. 4个 D4as_v2，共计 16 Core 算力

我们测试的主要目的是模拟在生产环境下的吞吐，所以我选择的测试方式如下

1. 准备一台 16Core 64G 的 MySQL 实例，用于存储数据
2. 创建一张表，随机写入100万数据
3. 在框架代码中进行 SQL 查询，返回查询结果

MySQL 表结构如下

```sql
create table  if not exists  `demo_data`
(
    `id`          bigint(20)   not null auto_increment,
    `name`        varchar(255) not null,
    `create_time` timestamp default CURRENT_TIMESTAMP,
    `update_time` timestamp default CURRENT_TIMESTAMP,
    primary key (`id`),
    index (`name`)
) charset = utf8mb4
  engine = innodb;
```

Django 代码如下

```python
import random

from django.core import serializers
from django.shortcuts import HttpResponse

from .models import DemoData

TEMP = "1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%^&*()_+=-"


# Create your views here.
def demo_views(request):
    result = DemoData.objects.filter(
        name="".join(random.choices(TEMP, k=random.randrange(1, 254)))
    )
    # x = json.dumps(request.body)
    return HttpResponse(
        serializers.serialize("json", result if result else []),
        content_type="application/json",
    )
```

Flask 代码如下

```python
import json
import random

import os
import dataset
from flask import Flask, Response

app = Flask(__name__)

DATABASE_URL = f"mysql://{os.getenv('DATABASE_USER')}:{os.getenv('DATABASE_PASSWORD')}@{os.getenv('DATABASE_HOST')}:3306/demo"
db = dataset.connect(DATABASE_URL, engine_kwargs={"pool_size": 10000})

TEMP = "1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%^&*()_+=-"


@app.route("/demo", methods=["GET"])
def demo_code():
    return Response(
        response=json.dumps(
            list(
                db.query(
                    f"select * from demo_data where name='{''.join(random.choices(TEMP, k=random.randrange(1, 254)))}'"
                )
            ),
            default=str
        ),
        status=200,
        content_type="application/json",
    )


if __name__ == "__main__":
    app.run(debug=True)
```

FastAPI 代码如下

```python
import random
import os
from typing import List

import databases
import pymysql
import sqlalchemy
import json
from fastapi import FastAPI
from fastapi.responses import Response
from pydantic import BaseModel

pymysql.install_as_MySQLdb()

AYSNC_DATABASE_URL = f"mysql+aiomysql://{os.getenv('DATABASE_USER')}:{os.getenv('DATABASE_PASSWORD')}@{os.getenv('DATABASE_HOST')}:3306/demo"
SYNC_DATABASE_URL = f"mysql+mysqldb://{os.getenv('DATABASE_USER')}:{os.getenv('DATABASE_PASSWORD')}@{os.getenv('DATABASE_HOST')}:3306/demo"

database = databases.Database(AYSNC_DATABASE_URL, max_size=10000)

metadata = sqlalchemy.MetaData()

demo_data = sqlalchemy.Table(
    "demo_data",
    metadata,
    sqlalchemy.Column("id", sqlalchemy.Integer, primary_key=True),
    sqlalchemy.Column("name", sqlalchemy.String),
    sqlalchemy.Column("create_time", sqlalchemy.DATETIME),
    sqlalchemy.Column("update_time", sqlalchemy.DATETIME),
)
engine = sqlalchemy.create_engine(SYNC_DATABASE_URL)
metadata.create_all(engine)
TEMP = "1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%^&*()_+=-"


class DemoData(BaseModel):
    id: int
    name: str


app = FastAPI()

init = False


@app.get("/demo", response_model=List[DemoData])
async def demo_code():
    global init
    if not init:
        await database.connect()
        init = True

    query = demo_data.select().where(
        demo_data.c.name == "".join(random.choices(TEMP, k=random.randrange(1, 254)))
    )
    data = await database.fetch_all(query)
    response = json.dumps(data, default=str)
    return Response(content=response, status_code=200, media_type="application/json")
```

Starlette 代码如下

```python
import random
import os
from typing import List

import databases
import pymysql
import json
import sqlalchemy
from starlette.applications import Starlette
from starlette.responses import Response
from starlette.routing import Route
from pydantic import BaseModel

pymysql.install_as_MySQLdb()

AYSNC_DATABASE_URL = f"mysql+aiomysql://{os.getenv('DATABASE_USER')}:{os.getenv('DATABASE_PASSWORD')}@{os.getenv('DATABASE_HOST')}:3306/demo"
SYNC_DATABASE_URL = f"mysql+mysqldb://{os.getenv('DATABASE_USER')}:{os.getenv('DATABASE_PASSWORD')}@{os.getenv('DATABASE_HOST')}:3306/demo"

database = databases.Database(AYSNC_DATABASE_URL, max_size=10000)

metadata = sqlalchemy.MetaData()

demo_data = sqlalchemy.Table(
    "demo_data",
    metadata,
    sqlalchemy.Column("id", sqlalchemy.Integer, primary_key=True),
    sqlalchemy.Column("name", sqlalchemy.String),
    sqlalchemy.Column("create_time", sqlalchemy.DATETIME),
    sqlalchemy.Column("update_time", sqlalchemy.DATETIME),
)
engine = sqlalchemy.create_engine(SYNC_DATABASE_URL)
metadata.create_all(engine)
TEMP = "1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%^&*()_+=-"


class DemoData(BaseModel):
    id: int
    name: str


init = False


async def demo_code(request):
    global init
    if not init:
        await database.connect()
        init = True

    query = demo_data.select().where(
        demo_data.c.name == "".join(random.choices(TEMP, k=random.randrange(1, 254)))
    )
    data = await database.fetch_all(query)
    return Response(content=json.dumps(data, default=str), status_code=200, media_type="application/json")

routes = [
    Route("/demo", demo_code, methods=["GET"]),
]

app = Starlette(debug=False, routes=routes)
```

然后部署方式如下

1. 各服务都部署在 K8S 上，POD 类型为 Guaranteed
2. 所有镜像都基于 3.12 构建
3. 服务限制 6Core 的 CPU
4. Django 和 Flask 基于 Gevent + Gunicorn 进行部署，利用 Greenify 对二进制进行 Patch
5. FastAPI 和 Starlette 基于 uvicorn 进行部署，使用 uvloop 作为 event loop

OK， 我们现在来公布测试结果

## 标准操作下的测试结果

Django:

![django](https://i.imgur.com/28P4bcT.png)

FastAPI

![FastAPI](https://i.imgur.com/T1xiYZe.png)

Flask

![Flask](https://i.imgur.com/mUkzLNf.png)

Starlette 

![Starlette](https://i.imgur.com/8Fu8vST.png)

Django 毫无疑问的最后，其余三者的性能是 Flask + Gevent > Starlette > FastAPI，后三个框架 CPU 占用率均 > 90%

## 空转测试

为了保险起见，我们将后续三个框架进行空转测试

Flask

![Flask](https://i.imgur.com/9DjHr00.png)

FastAPI

![FastAPI](https://i.imgur.com/4hq7gqo.png)

Starlette

![Starlette](https://i.imgur.com/Pugbi7M.png)

Starlette > FastAPI > Flask + Gevent

## 总结

目前来看，整体结论是这样

1. 在空转情况下，asyncio 的性能要搞出 Gevent 不少，加上框架因素后，也有百分之10-20% 的提升
2. 在 ORM + MySQL Driver 的情况下，Gevent 的生态要好于 asyncio 的生态

如果换成 ORM + PGSQL 的生态结论会不会更好一些呢？有点期待下一轮测试的结果

