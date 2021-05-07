---
title: 简单聊聊 SQL 中的 Prepared Statements
type: tags
date: 2020-01-05 20:00:00
tags: [Python,编程,MySQL]
categories: [编程,Python,MySQL]
toc: true
---

好久没写文章了，新年还是得写点技术水文来保证下状态，正好最近遇到一个比较有意思的问题，就来简单聊聊一下关于 MySQL 中 Prepared Statements 吧

<!--more-->

## 开始

[gorm](https://github.com/jinzhu/gorm) 是大家在使用 Go 开发时的比较常用的 ORM 了，最近在使用 gORM 的时候遇到一个很有意思的问题。首先我大概描述一下这个问题

在使用 gORM 的 `Raw` 方法进行 SQL 查询时，构造了如下类似的 SQL 

```SQL
select * from demo where match(name) AGAINST('+?' IN BOOLEAN MODE)
```

在随后传入参数的时候，返回 `Error` : **sql: expected 0 arguments, got 1**。而其余的诸如如下的查询就正常执行

```SQL
select * from demo where name = ?
```

最开始我以为这是 `gORM` 中拼接 SQL 模块的问题，但是看了下代码后发现一个很有趣的逻辑。**gORM** 中并没有拼接 `Raw SQL` 的相关逻辑，它会直接调用 Golang 中的标准库 `database/sql` 来进行 SQL 的处理，而 `database/sql` 将会直接调用对应数据库驱动的实现，我们先来看看在 `databse/sql` 中关于 Query 的逻辑。

```go
func (db *DB) queryDC(ctx, txctx context.Context, dc *driverConn, releaseConn func(error), query string, args []interface{}) (*Rows, error) {
	queryerCtx, ok := dc.ci.(driver.QueryerContext)
	var queryer driver.Queryer
	if !ok {
		queryer, ok = dc.ci.(driver.Queryer)
	}
	if ok {
		var nvdargs []driver.NamedValue
		var rowsi driver.Rows
		var err error
		withLock(dc, func() {
			nvdargs, err = driverArgsConnLocked(dc.ci, nil, args)
			if err != nil {
				return
			}
			rowsi, err = ctxDriverQuery(ctx, queryerCtx, queryer, query, nvdargs)
		})
		if err != driver.ErrSkip {
			if err != nil {
				releaseConn(err)
				return nil, err
			}
			// Note: ownership of dc passes to the *Rows, to be freed
			// with releaseConn.
			rows := &Rows{
				dc:          dc,
				releaseConn: releaseConn,
				rowsi:       rowsi,
			}
			rows.initContextClose(ctx, txctx)
			return rows, nil
		}
	}

	var si driver.Stmt
	var err error
	withLock(dc, func() {
        // 比较有意思的地方
		si, err = ctxDriverPrepare(ctx, dc.ci, query)
	})
	if err != nil {
		releaseConn(err)
		return nil, err
	}

	ds := &driverStmt{Locker: dc, si: si}
	rowsi, err := rowsiFromStatement(ctx, dc.ci, ds, args...)
	if err != nil {
		ds.Close()
		releaseConn(err)
		return nil, err
	}

	// Note: ownership of ci passes to the *Rows, to be freed
	// with releaseConn.
	rows := &Rows{
		dc:          dc,
		releaseConn: releaseConn,
		rowsi:       rowsi,
		closeStmt:   ds,
	}
	rows.initContextClose(ctx, txctx)
	return rows, nil
}
}
```

在 `database/sql` 执行 **QueryDC** 逻辑时，会调用 `ctxDriverPrepare` 方法来进行 SQL Query 的预处理，我们来看看这段逻辑 

```go
func ctxDriverPrepare(ctx context.Context, ci driver.Conn, query string) (driver.Stmt, error) {
	if ciCtx, is := ci.(driver.ConnPrepareContext); is {
		return ciCtx.PrepareContext(ctx, query)
	}
	si, err := ci.Prepare(query)
	if err == nil {
		select {
		default:
		case <-ctx.Done():
			si.Close()
			return nil, ctx.Err()
		}
	}
	return si, err
}
```

在其中，`ctxDriverPrepare` 会调用 `ci.Prepare(query)` 来执行对应 SQL Driver 实现的 `Prepare` 或者 `PrepareContext` 方法来对 SQL 预处理，在 [go-mysql-driver](https://github.com/go-sql-driver/mysql/blob/v1.4.1/connection_go18.go#L92) 中，对应的实现是这样

```go
func (mc *mysqlConn) PrepareContext(ctx context.Context, query string) (driver.Stmt, error) {
	if err := mc.watchCancel(ctx); err != nil {
		return nil, err
	}

	stmt, err := mc.Prepare(query)
	mc.finish()
	if err != nil {
		return nil, err
	}

	select {
	default:
	case <-ctx.Done():
		stmt.Close()
		return nil, ctx.Err()
	}
	return stmt, nil
}
```

这一段的逻辑是 `go-mysql-driver` 会向 MySQL 发起 `prepared statement` 请求，获取到对应的 `Stmt` 后将其返回

在 `stmt` 中包含了对应的参数数量，`stmt name` 等信息。在这里，SQL 会将 ? 等参数占位符进行解析，并告知客户端需要传入的参数数量

问题也出在这里，我们重新看一下之前的 SQL

```sql
select * from demo where match(name) AGAINST('+?' IN BOOLEAN MODE)
```

在这里，我使用了 MySQL 5.7 后支持的 Full Text Match ，在这里，我们待匹配的字符串 `+?` 会被 MySQL 解析成为一个待查询的字符串，而不会作为占位符进行解析，那么返回 `stmt` 中，需要传入的参数数量为0，而 `database/sql` 会在后续的逻辑中对我们传入的参数和需要传入的参数数量进行匹配，如果不一致则会抛出 `Error` 。

好了，问题找到了，那么 `Prepared Statement` 究竟是什么东西，而我们为什么又需要这个？

## Prepared Statement

### 什么是 Prepared Statement？

其实大致的内容前面已经聊的比较清楚了，我们来重新复习下：`Prepared Statement` 是一种 MySQL（其余的诸如 PGSQL 也有类似的东西）的机制，用于预处理 SQL，将 SQL 和查询数据分离，以期保证程序的健壮性。

在 MySQL 官方的介绍中，Prepared Statement 有如下的好处

> 1. Less overhead for parsing the statement each time it is executed. Typically, database applications process large volumes of almost-identical statements, with only changes to literal or variable values in clauses such as `WHERE` for queries and deletes, `SET` for updates, and `VALUES` for inserts.
> 2. Protection against SQL injection attacks. The parameter values can contain unescaped SQL quote and delimiter characters.

简而言之是：

1. 提升性能，避免重复解析 SQL 带来的开销
2. 避免  SQL 注入

MySQL 的 `Prepared Statement` 有两种使用方式，一种是使用二进制的 `Prepared Protocol`（这个不在今天的文章的范围内，改天再写篇文章来聊聊 MySQL 中的一些二进制协议） ，一种是使用 SQL 进行处理

在 `Prepared Statement` 中有着三种命令

1. [`PREPARE`](https://dev.mysql.com/doc/refman/8.0/en/prepare.html) 用于创建一个 `Prepared Statement`
2. [`EXECUTE`](https://dev.mysql.com/doc/refman/8.0/en/execute.html) 用于执行一个 `Prepared Statement`
3. [`DEALLOCATE PREPARE`](https://dev.mysql.com/doc/refman/8.0/en/deallocate-prepare.html) 用于销毁一个 `Prepared Statement` 

这里需要注意一点的是，`Prepared Statement` 存在 Session 限制，一般情况下一个 `Prepared Statement` 仅存活于它被创建的 `Session` 。当连接断开，者在其余情况下 Session 失效的时候，`Prepared Statement` 会自动被销毁。

接下来，我们来动手实验下

### 怎么使用 Prepared Statement

首先我们先创建一个 测试表

```sql
create table if not exists `user`
(
    `id`   bigint(20)   not null auto_increment,
    `name` varchar(255) not null,
    primary key (`id`)
) engine = InnoDB
  charset = 'utf8mb4';
```

然后插入数据

```sql
insert into user (`name`) values ('abc');
```

好了，我们先按照传统的方式进行查询下

```sql
select *
from user
where name = 'abc';
```

好了，我们现在来使用 `Prepared Statement` 

首先使用 `Prepared` 关键字创建一个 `statement`

```sql
set @s = 'select * from user where name=?';

PREPARE demo1 from @s;
```

然后使用 `Execute` 关键字来执行 `Statement`

```sql
set @a = 'abc';

EXECUTE demo1 using @a;
```

嗯，还是很简单的对吧

### 为什么要使用 Prepared Statement？

其中一个很重要的理由是可以避免 `SQL Injection Attack` （SQL 注入）的情况出现，而问题在于，为什么 `Prepared Statement` 能够避免 SQL 注入？

其实很简单，我们将 `Query` 和 `Data` 进行了分离

还是以之前的表作为例子

在没有手动处理 SQL 和 参数的情况下，我们往往使用字符串拼接，那么这样会利用 SQL 语法来构造一些非法 SQL，以 Python 为例

```python
b = "'abc';drop table user"
a = f"select * from user where name={b}"
```

那么这样一段代码将会生成这样的 SQL

```sql
select * from user where name='abc';drop table user
```

嗯，，，，数据库从入门到删表跑路.pdf

那么，我们来使用 `Prepared Statement` 来看看

```sql
set @a = '\'abc\';drop table user';

EXECUTE demo1 using @a;
```

然后我们最后执行的语句是

```sql
select * from user where name='\'abc\';drop table user'
```

因为我们将 Query 与 Query Params 在结构上进行了区分，这个时候我们无论输入什么，都会将其作为 Query Params 的一部分进行处理，从而避免了注入的风险

### Prepared Statement 的优劣

好处显而易见

1. 因为数据库会对 `Prepared Statement ` 进行缓存，从而免去了客户端重复处理 SQL 带来的开销
2. 避免 `SQL Injection Attack` 
3. 语义清楚

缺点也有不少

1. `Prepared Statement` 的二进制协议存在客户端兼容的问题，有些语言的客户端不一定会对 `Prepared Statement` 提供二进制的协议支持
2. 因为存在两次与数据库的通信，在密集进行 SQL 查询的情况下，可能会出现 I/O 瓶颈

所以具体还是要根据场景来做 Trade-off 了

## 碎碎念

飞机上写下这篇文章算是作为新年的一个新开始吧，争取多写文章，规范作息，好好照顾女朋友。对了，通过这段时间的一些折腾（比如解析 Binlog 之类的），突然发现 MySQL 是个宝库，后面会写几篇文章来聊聊踩坑 MySQL 中的 `Binlog` 和 `Protocol` 中的一些坑和好玩的地方（嗯 Flag ++，千万别催稿（逃

好了，今晚就先这样，飞机要落地了，我先关电脑了（逃