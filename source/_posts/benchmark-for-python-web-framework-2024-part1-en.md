---
title: In 2024, Gevent or asyncio? Part 1
type: tags
date: 2024-08-20 01:00:00
tags: [Programming, CPython, Notes, Casual Writing]
categories: [Programming, CPython]
toc: true
---

The choice between Gevent and asyncio has always been a classic question. Here, we'll use data to help you make a decision.

<!--more-->

## Introduction

Professor Lin Wei has set a high standard:

![HiRedis](https://i.imgur.com/Jk2ubDY.png)

This graph shows the extreme performance of asyncio and Gevent. We can see that asyncio with uvloop is basically double the performance of Gevent.

But is this the case under web frameworks?

Let's conduct an experiment.

First, let's talk about the configuration of the load machine. I chose a D8as_v5 machine on Azure with the following configuration:

1. 8 Core 32GB configuration
2. The underlying hardware is based on the EPYC 7763 series processor
3. A total of 4 nodes, allocated to Django/Flask/FastAPI/Starlette, four different frameworks

We chose locust as our load testing framework, also based on a Kubernetes cluster. Because the quota for D8as_v5 machines in my account wasn't sufficient, we chose a mixed deployment of different machines for the load testing framework:

1. 4 D8as_v5, totaling 32 Core computing power
2. 4 D8as_v3, totaling 32 Core computing power
3. 4 D4as_v2, totaling 16 Core computing power

Our main purpose for testing is to simulate throughput in a production environment, so I chose the following test method:

1. Prepare a 16 Core 64GB MySQL instance for data storage
2. Create a table and randomly write 1 million data entries
3. Perform SQL queries in the framework code and return the query results

The MySQL table structure is as follows:

```sql
create table if not exists `demo_data`
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

Django code is as follows:

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

Flask code is as follows:

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

FastAPI code is as follows:

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

Starlette code is as follows:

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

The deployment method is as follows:

1. All services are deployed on K8S, with POD type as Guaranteed
2. All image is built base on the Python 3.12
3. Services are limited to 6 Core CPU
4. Django and Flask are deployed based on Gevent + Gunicorn, using Greenify to patch the binary
5. FastAPI and Starlette are deployed based on uvicorn, using uvloop as the event loop

OK, now let's reveal the test results.

## Test Results Under Standard Operations

Django:

![django](https://i.imgur.com/28P4bcT.png)

FastAPI:

![FastAPI](https://i.imgur.com/T1xiYZe.png)

Flask:

![Flask](https://i.imgur.com/mUkzLNf.png)

Starlette:

![Starlette](https://i.imgur.com/8Fu8vST.png)

Django is undoubtedly the last, while the performance of the other three is Flask + Gevent > Starlette > FastAPI. The CPU usage of the latter three frameworks is all > 90%.

## Idle Test

To be on the safe side, we conducted an idle test on the latter three frameworks.

Flask:

![Flask](https://i.imgur.com/9DjHr00.png)

FastAPI:

![FastAPI](https://i.imgur.com/4hq7gqo.png)

Starlette:

![Starlette](https://i.imgur.com/Pugbi7M.png)

Starlette > FastAPI > Flask + Gevent

## Conclusion

Currently, the overall conclusions are as follows:

1. In idle situations, the performance of asyncio is significantly better than Gevent. Even with the framework factor, there is still a 10-20% improvement.
2. In the case of ORM + MySQL Driver, Gevent's ecosystem is better than asyncio's ecosystem.

If we switch to ORM + PGSQL ecosystem, will the conclusion be even better? Looking forward to the results of the next round of tests.
