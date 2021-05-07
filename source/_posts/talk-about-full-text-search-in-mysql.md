---
title: 简单聊聊 MySQL 全文索引
type: tags
date: 2020-03-01 19:30:00
tags: [Python,编程,MySQL]
categories: [编程,Python,MySQL]
toc: true
---


最近踩 MYSQL 中文本搜索的坑踩了挺多，来写个具体的文章总结下 MYSQL 中文本搜索的一些知识点吧

<!--more-->

## 模糊搜索

在我们是使用 MYSQL 的过程中，总会有一些模糊搜索的需求，比如我们现在有这样一张表

```sql
create table if not exists `user`
(
    `id`         bigint(20)   not null auto_increment,
    `name`       varchar(255) not null,
    `age`        int          not null,
    `update_time` timestamp    not null,
    `create_time` timestamp    not null,
    index (`name`),
    primary key (`id`)
) engine = InnoDB
  charset = 'utf8mb4';
```

现在我们需要对于 `name` 做一些模糊匹配的需求，比如我们需要去匹配 `name` 中包含 `草` 字，于是大家仔细一想，OK，写出了如下的 SQL

```sql
select * from user where name like '%草%'
```

好了，当你行高采烈的将这段代码上线后，你发现，线上炸了，为啥？因为 MYSQL 的坑. MYSQL 的 like 查询存在这样两个限制

1. 只有前缀匹配 '草%' 和后缀匹配 '%草' 才会走索引，而任意匹配则不会
2. 当无法走索引的时候，MYSQL 会遍历全表来查询数据

当你一个表的数据规模很大的时候，那么暴力扫表必然会带来极大的开销

但是我们实际工作中这样的任意匹配的需求肯定很多，那么我们应该怎么做？或许可以尝试下全文搜索

## 全文搜索

### 简单聊聊全文搜索

全文搜索大家已经不太陌生了，简而言之用一种不太精确的说法就是，用一组关键词在一堆文本数据中寻找匹配项。在目前业界比较主流的全文搜索方案有：

1. 支持全文搜索的关系行数据库
2. Apache Lucene
3. 基于 Apache Lucene 的 ElasticSearch
4. Apache Solr

后两种是目前业界主要的方案，可能很多全文搜索的需求都会考虑用 ES 或者 Solr 实现。但是这样一种方法并不是无代价的。有这样几个比较现实的问题

1. ES/Solr 在数据量比较大的情况下的运维问题，怎么样保证集群的 HA 将是一个很考研团队功底的问题
2. 怎么样将 MYSQL 或其余数据源中的数据实时/离线 ETL 至 Search Engine 中
3. 新增的学习与 Codebase 的维护成本。
4. 新增一个依赖之后，对于系统整体的 HA 的保证

在技术决策中，我们往往需要去衡量一个选项的 ROI 来辅助决策。如果我们面对一个比较简单的搜索场景，那么选用 ES/Solr 所带来的开销将会使其 ROI 变得相对较低。因此在一些简单的场景，我们可能会更希望利用数据库本身的能力来完成我们的需求

所幸，在 MySQL 5.5 之后，其支持了一定的全文搜索的能力

### MySQL 全文搜索

MYSQL 全文搜索的前提是需要在表中建立一个 Full Text Index

```sql
alter table `user`
    ADD FULLTEXT INDEX name_index (`name`);
```

注意全文索引，仅对类型为 `CHAR`/`VARCHAR`/`TEXT` 的字段生效。

然后，我们插入两条数据 

```sql
insert into `user` (name, age, createTime, updateTime)
values ('Jeff.S.Wang', 18, current_timestamp, current_timestamp);

insert into `user` (name, age, createTime, updateTime)
values ('Jeff.Li', 18, current_timestamp, current_timestamp);
```

好了，我们可以来看看 MYSQL 怎么进行全文查询了

首先，按照官方的定义，

```text
MATCH (col1,col2,...) AGAINST (expr [search_modifier])
```

而 `search_modifier` 是所选取的匹配模式，在MYSQL中共有四种

1. IN NATURAL LANGUAGE MODE 自然语言模式
2. IN NATURAL LANGUAGE MODE WITH QUERY EXPANSION 自然语言带扩展模式
3. IN BOOLEAN MODE 逻辑模式
4. WITH QUERY EXPANSION 扩展模式

我们常用的是 **自然语言模式** 和 **逻辑模式**。

首先来聊聊 **自然语言模式**，很简单，顾名思义，MYSQL 会直接计算待匹配关键字，然后返回对应的值，这里引用一段官网的解释：

> By default or with the IN NATURAL LANGUAGE MODE modifier, the MATCH() function performs a natural language search for a string against a text collection. A collection is a set of one or more columns included in a FULLTEXT index. The search string is given as the argument to AGAINST(). For each row in the table, MATCH() returns a relevance value; that is, a similarity measure between the search string and the text in that row in the columns named in the MATCH() list.

我们来写一段 SQL 

```sql
select * 
from `user` 
where MATCH(name) AGAINST('Jeff' IN NATURAL LANGUAGE MODE)
```

然后我们发现能得到如下的结果


| id | name        | age | updateTime          | createTime          |
|----|-------------|-----|---------------------|---------------------|
| 1  | Jeff Li     | 18  | 2020-03-01 15:38:07 | 2020-03-01 15:38:07 |
| 2  | Jeff.S.Wang | 18  | 2020-03-01 15:42:28 | 2020-03-01 15:42:28 |

然后，我们来尝试匹配下用户的 LastName，比如我们想找一位姓 Wang 的用户

然后我们写出了如下的 SQL

```sql
select * 
from `user` 
where MATCH(name) AGAINST('Jeff' IN NATURAL LANGUAGE MODE)
```

得到如下结果

| id | name        | age | updateTime          | createTime          |
|----|-------------|-----|---------------------|---------------------|
| 2  | Jeff.S.Wang | 18  | 2020-03-01 15:42:28 | 2020-03-01 15:42:28 |

然后我们开始尝试，去搜索一位姓 Li 的用户，然后我们写下了，如下的 SQL

```sql
select * 
from `user` 
where MATCH(name) AGAINST('Li' IN NATURAL LANGUAGE MODE)
```

然后我们发现，什么结果都没有？？？？？WTF？Why？

原因在于分词粒度，在我们进行录入新数据的时候，MySQL 会将我们的索引字段中的数据按照一定的分词基准长度进行分词，然后存储以待查询，其有四个参数控制分词的长度

1. innodb_ft_min_token_size 
2. innodb_ft_max_token_size 
3. ft_min_word_len 作用同上，不过是针对 MyISAM 引擎
4. ft_max_word_len 

以 InnoDB 为例，其默认的 `innodb_ft_min_token_size` 的值是 3，换句话说在我们之前的录入的数据中，我们数据中存储的分词后的单元是

1. Jeff
2. Wang

所以我们第二次搜索没有结果，现在我们将 MySQL 的参数修改一下后，重新执行一下？

```sql
select * 
from `user` 
where MATCH(name) AGAINST('Li' IN NATURAL LANGUAGE MODE)
```

还还还是不行？？？？

查了下官方文档后，我们发现有这样的描述

> Some variable changes require that you rebuild the FULLTEXT indexes in your tables. Instructions for doing so are given later in this section.

而索引分词粒度也包含在其中，，所以我们需要删除/rebuild索引，，然后重新执行（有点坑。。）

```sql
select * 
from `user` 
where MATCH(name) AGAINST('Li' IN NATURAL LANGUAGE MODE)
```

好了，现在正常的返回结果了

| id | name        | age | updateTime          | createTime          |
|----|-------------|-----|---------------------|---------------------|
| 1  | Jeff Li     | 18  | 2020-03-01 15:38:07 | 2020-03-01 15:38:07 |

现在让我们来聊聊另一种匹配模式，BOOLEAN MODE 

逻辑模式允许我们用一些操作符来检索一些数据，我们举一些常见的例子，剩下大家可以去看看 MYSQL 官方文档

1. AGAINST('Jeff Li' IN BOOLEAN MODE) 表示，要么存在 **Jeff** 要么存在 **Li**
2. AGAINST('+Jeff' IN BOOLEAN MODE) 表示，必须存在 **Jeff**
3. AGAINST('+Jeff -Li' IN BOOLEAN MODE) 表示 必须存在 **Jeff** 且 **Li** 必须不存在

我们来执行下这几个 SQL

```sql
select * 
from `user` 
where MATCH(name) AGAINST('Jeff Li' IN BOOLEAN MODE)
```

结果

| id | name        | age | updateTime          | createTime          |
|----|-------------|-----|---------------------|---------------------|
| 1  | Jeff Li     | 18  | 2020-03-01 15:38:07 | 2020-03-01 15:38:07 |
| 2  | Jeff.S.Wang | 18  | 2020-03-01 15:42:28 | 2020-03-01 15:42:28 |


```sql
select *
from `user` 
where MATCH(name) AGAINST('+Jeff' IN BOOLEAN MODE)
```

结果

| id | name        | age | updateTime          | createTime          |
|----|-------------|-----|---------------------|---------------------|
| 1  | Jeff Li     | 18  | 2020-03-01 15:38:07 | 2020-03-01 15:38:07 |
| 2  | Jeff.S.Wang | 18  | 2020-03-01 15:42:28 | 2020-03-01 15:42:28 |

```sql
select * 
from `user` 
where MATCH(name) AGAINST('+Jeff -Li' IN BOOLEAN MODE) 
```

结果

| id | name        | age | updateTime          | createTime          |
|----|-------------|-----|---------------------|---------------------|
| 2  | Jeff.S.Wang | 18  | 2020-03-01 15:42:28 | 2020-03-01 15:42:28 |


好，现在我们有一些中文搜索的需求，我们先来插入数据

```sql
insert into `user` (name, age, createTime, updateTime)
values ('奥特曼', 18, current_timestamp, current_timestamp);
```

现在我们来搜索姓**奥**的用户，我们按照之前的 Guide 写出了如下的 SQL

```sql
select *
from `user`
where MATCH(name) AGAINST('+奥' IN BOOLEAN MODE)
```

然后我们惊喜的发现，又又又没有结果？？？Why？？？

其实还是之前提到过的一个问题，**分词**，MySQL 的默认的分词引擎，只支持英文的分词，而不支持中文分词，那么没有分词，没有搜索？怎么办？

在 MySQL 5.7 之后，MySQL 提供了 `ngram` 这个组件来帮助我们进行中文分词，使用很简单

```sql
alter table `user`
    add fulltext index name_index (`name`) with parser ngram;
```

这里有几点要注意：

1. ngram 不仅适用于中文，按照官方文档，韩文，日文也都支持
2. 一个字段上只能有一个全文索引，所以需要删除原有全文索引

同时，如同默认的分词一样，**ngram** 也受分词粒度的限制，不过 **ngram** 的设置参数是

1. ngram_token_size

我们按照需要设置即可

## 总结

全文搜索对于日常开发来讲，是一个很常见的需求，在我们的 infra 没法让我们去安心的使用外部组件的时候，利用数据库提供的能力也许是个不错的选项。不过还是有很多的坑要踩，有很多的参数要优化。。BTW 阿里云的 RDS 设置真的难用（小声吐槽

好了。。我的拖延症实在没救了。。而且这两天牙疼真的无奈，呜呜呜呜呜
