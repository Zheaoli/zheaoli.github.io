---
title: Dynamic Query for Spring Data JPA
type: tags
date: 2020-02-03 02:00:00
tags: [Python,编程,leetcode,刷题]
categories: [编程,leetcode,刷题]
toc: true
---
今天正好遇到一个 Spring Data Jpa 中很有趣的问题，干脆睡前写个博客来记录一下

<!--more-->

## 背景

假设我们有这样一张表

```sql
create table if not exists `user`
(
    `id`         bigint(20)   not null auto_increment,
    `name`       varchar(255) not null,
    `age`        int          not null,
    `updateTime` timestamp    not null,
    `createTime` timestamp    not null,
    primary key (`id`)
) engine = InnoDB
  charset = 'utf8mb4';
```

现在有这样一个场景：根据字段拼接查询，当 name 的值不为空的时候，需要依据当前 name 进查询，如果 age 不为空则同理，如果两者都不为空，则需要依据所有条件进行查询

在 MyBatis 中，可以利用其提供给的语法进行 SQL 的动态拼接