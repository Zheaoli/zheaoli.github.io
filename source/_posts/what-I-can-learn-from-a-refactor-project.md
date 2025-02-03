---
title: 从一个重构项目中能学到什么东西
type: tags
date: 2023-01-27 00:00:00
tags: [杂记,技术]
categories: [杂记,技术]
toc: true
---

本来这篇文章是要在 2022 最后一个工作日前写完的，但是拖延癌发作，到现在才写完。不过还是发出来，希望里面的内容能帮到大家

<!--more-->

## 背景介绍

这个重构项目如果从我第一个超大型重构 PR 算起（22年12月11日），到现在已经历史一个半月了。目前重构进度已经超过了 80%，超过6+位贡献者集体贡献。这绝对是个不小的工程了

那问题来了，我为什么要发起这个重构项目呢？

在重构项目之前，nerdctl 项目存在一个很大的问题，即 command 的入口处，flag 的处理和逻辑耦合的问题，比如用 `nerdctl apparmor` 系列的代码来举一个例子

```go
package main

import (
	"bytes"
	"errors"
	"fmt"
	"text/tabwriter"
	"text/template"

	"github.com/containerd/nerdctl/pkg/apparmorutil"
	"github.com/spf13/cobra"
)

func newApparmorLsCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:           "ls",
		Aliases:       []string{"list"},
		Short:         "List the loaded AppArmor profiles",
		Args:          cobra.NoArgs,
		RunE:          apparmorLsAction,
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	cmd.Flags().BoolP("quiet", "q", false, "Only display profile names")
	// Alias "-f" is reserved for "--filter"
	cmd.Flags().String("format", "", "Format the output using the given go template")
	cmd.RegisterFlagCompletionFunc("format", func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		return []string{"json", "table", "wide"}, cobra.ShellCompDirectiveNoFileComp
	})
	return cmd
}

func apparmorLsAction(cmd *cobra.Command, args []string) error {
	quiet, err := cmd.Flags().GetBool("quiet")
	if err != nil {
		return err
	}
	w := cmd.OutOrStdout()
	var tmpl *template.Template
	format, err := cmd.Flags().GetString("format")
	if err != nil {
		return err
	}
	switch format {
	case "", "table", "wide":
		w = tabwriter.NewWriter(cmd.OutOrStdout(), 4, 8, 4, ' ', 0)
		if !quiet {
			fmt.Fprintln(w, "NAME\tMODE")
		}
	case "raw":
		return errors.New("unsupported format: \"raw\"")
	default:
		if quiet {
			return errors.New("format and quiet must not be specified together")
		}
		var err error
		tmpl, err = parseTemplate(format)
		if err != nil {
			return err
		}
	}

	profiles, err := apparmorutil.Profiles()
	if err != nil {
		return err
	}

	for _, f := range profiles {
		if tmpl != nil {
			var b bytes.Buffer
			if err := tmpl.Execute(&b, f); err != nil {
				return err
			}
			if _, err = fmt.Fprintf(w, b.String()+"\n"); err != nil {
				return err
			}
		} else if quiet {
			fmt.Fprintln(w, f.Name)
		} else {
			fmt.Fprintf(w, "%s\t%s\n", f.Name, f.Mode)
		}
	}
	if f, ok := w.(Flusher); ok {
		return f.Flush()
	}
	return nil
}
```

你能看到在函数 `apparmorLsAction` 的逻辑中包含了两个部分的东西

1. flag 的处理（大道至简的 err 处理（XDDDDD
2. command logic 的处理

这样的设计存在很明显的问题

1. 代码可读性与可维护性的问题，比如我需要添加一个 flag 的时候，那么需要在多处添加。而且满天飞的 flagging process 会导致提升新人进入项目的门槛
2. logic 的处理与 flag 的处理耦合在一起，这样会额外导致如果社区在试图基于 nerdctl 封装一套自定义的 CLI 脚手架的时候，那么会出现非常难处理的情况。

同时 nercdctl 还存在另外一个问题。在 cmd 的入口处，因为同归属于一个 sub package，于是之前的开发过程中为了省事，文件之间为了省事，交叉引用了彼此的 internal helper function

在 nerdctl 项目最开始只作为 containerd CLI 的一个替代品的时候。之前的设计缺陷实际上暴露的并不明显。但是 nerdctl 完整提供了一套基于 containerd 的容器生命周期及网络管理（base on CNI）及其余进阶特性（比如 cosign，IPFS 等），开始作为 containerd 实质上的一个入口标准的时候。社区无疑会提出更高的需求。比如 [Move *.go files for subcommand out main package nerdctl#1631](https://github.com/containerd/nerdctl/issues/1631) 就是一个很典型的例子。

在这种情况下，对于 nerdctl 的入口进行一个合理的但是大范围的重构，就是一个必须且迫在眉睫的事了。

> 又到了~~白色相薄~~重构的季节 --- 蛮久抚子（Nadeshiko Manju）

## 重构过程分析

好了，社区有需要，saka 哦不，蛮久抚子（Nadeshiko Manju）我就得站出来了，重构嘛，很简单嘛，Goland 搞一搞就完事了嘛。好说好说。于是我有了一个超大的 PR ：[Refactor the package structure in cmd/nerdctl nerdctl#1639](https://github.com/containerd/nerdctl/pull/1639)。规模 +5000 -4000

![よし、気合いが勝っとる!](https://user-images.githubusercontent.com/7054676/214850761-da34600d-a9b0-42de-88e8-97643a27d61d.png)

不过，因为这个 PR 太过于惊世骇俗，在我 COVID-19 Positive 后，Suda 开始帮我 carry 这个 PR。但是最后 Suda 也高呼不可 carry（Suda の惊く：ばか saka！）

> どうしてこうなるんだろう…初めて、リファクタリングしたいという欲求があり、リファクタリングの必要性がありました。嬉しいことが二つ重なって。その二つの嬉しさが、また、たくさんの嬉しさを連れてきてくれて。夢のように幸せな時間を手に入れたはずなのに…なのに、どうして、こうなっちゃうんだろう… 
> 为什么会变成这样呢，第一次有了想重构的欲望，又有了重构的必要。两件快乐事情重合在一起。而这两份快乐，又给我带来更多的快乐。得到的，本该是像梦境一般幸福的时间……但是，为什么，会变成这样呢…… ---- 《nerdctl 相薄》

实际上原因很简单 ~~冬马小三~~ ，哦不是，是我小三，哦，不是，是我脑子被门夹了

言归正传，其实这个 PR 是个教科书式的反面例子

1. 在启动大型项目之前没有达成社区的共识
2. 违背了 One PR for One Thing 的基本原则
3. 重构时的无关的改动太多，导致 review 难度过大

所以在吸取了 [Refactor the package structure in cmd/nerdctl nerdctl#1639](https://github.com/containerd/nerdctl/pull/1639) 的教训后，我正式在社区提出了一个重构 Proposal [Let's refactor the nerdctl CLI package nerdctl#1680](https://github.com/containerd/nerdctl/issues/1680) ，在这个 Proposal 中我做了几个事情

1. 完整阐述了重构的必要性，方便社区成员后续回溯
2. 定义了重构的几个 step
3. 约定好了多人协作重构时所共同遵守的约定

社区其余几位 maintainer 在这个 Proposal 下额外讨论了一些细节，并达成了一些共识

1. 将最终的重构范围缩小为仅处理 flagging process
2. 优化了一些文件结构的设计

截止到现在，nerdctl 的重构才算开始正式进入了一个快车道的状态。毕竟重构不是乱写，要是写错了，要向社区谢罪的。

这里面其实还有个插曲，最开始我在 Issue 中创建 TODO Task 之后，为了方便 track project 的进度，我将这些 TODO Task 直接全部转成了 Issue（然后就相当于给 subscribe 了这个 repo 的老哥们来了一个邮箱 DDOS）。这里不得不吐槽一句，GitHub 的项目管理工具真的很弱诶（XDDDDD

花开两朵，各表一只，在 Proposal 正式通过了之后，整体的重构就开始进入了快车道了，这里列一些有意思的讨论，大家有兴趣可以去看看

1. [Refactor the apparmor flagging process nerdctl#1774](https://github.com/containerd/nerdctl/pull/1774)，Proposal 接收后的一个模板 PR，在这个 PR 下，继续细化了一些在 Proposal 中讨论没有完善的细节
2. [[Refactor] Refactor the build subcommand flagging process nerdctl#1792](https://github.com/containerd/nerdctl/pull/1792)，Proposal 接收后第一个比较大命令的重构，某种意义上也是一个模板 PR 了，里面就讨论了不少参数设计风格的问题
3. [refactor: consolidate main logic of volume.List into volume.Volumes](https://github.com/containerd/nerdctl/pull/1837), 不属于 Proposal 原本涵盖的范围内，但是里面关于函数语义设计的讨论值得关注一下
4. [pkg/cmd: inconsistent arguments ordering nerdctl#1889](https://github.com/containerd/nerdctl/issues/1889)，关于函数设计风格的问题。

当然还有很多 PR 中的讨论也是非常有意思的，这里就不完整列出来了。欢迎大家去直接看原始的 PR（当然欢迎加入讨论）

## 总结

差不多就这样吧，大概复盘了一下到现在为止重构过程中的得失。希望大家能喜欢
