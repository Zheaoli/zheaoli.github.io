---
title: 简单聊聊 IaC：Infrastructure as Code
type: tags
date: 2023-03-12 21:00:00
tags: [编程,SRE,Tools,水文]
categories: [编程,杂记]
toc: true
---

实际上 IaC 这个概念的出现已经很久了，所以写篇水文来简单聊聊 IaC 的过去，现在，和将来

<!-- more -->

## IaC 的过去

实际上 IaC 的历史其实足够悠久。首先来看一下 IaC 的核心的特征

1. 最终的产物是 machine readable 的的产物。可能是一份代码，也可能是一份配制文件
2. 基于 machine readable 的产物，可以进一步依赖已有的 VCS 系统（SVN，Git）等做版本管理
3. 基于 machine readable 的产物，可以进一步依赖已有的 CI/CD 系统（Jenkins，Travis CI）等做持续集成/持续交付
4. 状态的一致性，或者称为幂等性。即理论上来讲，基于同样一份 Code，同一套参数构建出的产物，其最终的行为应该是一致的

实际上通过 IaC 这样的一些核心特征，我们现在能明白 IaC 兴起的原因。IaC 实际上的兴起，大背景是在千禧年之后，互联网世界迭代的速度愈发的快速，这个时候传统的手工式的维护面临着几个问题

1. 交互式变更所引入的人的因素太大，导致了变更的不可控性
2. 人工变更面对愈发快速的 Infra 迭代力有不逮
3. 交互式的变更导致管控的难做，让版本控制之类的手段变为空谈

在这样的时代背景下，大家都在追求用更技术，更优雅的手段来解决这些问题。于是，IaC 这个概念就出现了

如果说要将 IaC 分为几个阶段的话，那么我觉得可以分为以下几个阶段

1. 刀根火种阶段
2. 现代化的 IaC

如同前面所说，IaC 实际上是一个自发的驱动，在面对不确定的时候，我们选择用代码来尽可能的消泯掉不确定性（实际上这个原则一直贯穿到现在）

那么在最早期，人们选择用最基础的代码的形式，来完成 IaC 的工作。其特征是对于之前的各种交互式的手段的精确化，程序化的描述。人们可能会选择直接用 bash 来解决这一切（祖传的来路不明的 bash 脚本.jpg），也可能会基于 Python Fabric 这样的框架进行简单的封装来完成所需的程序化描述的工作。

但是我们回头去看这一阶段，我们能直观的感受到一些缺陷

1. 代码复用性较差
2. 各家都有一套祖传的 IaC 基建，没有统一的行业标准，导致新人入门门槛较高

所以在面对这样一套的问题的时候。更现代化的 IaC 设施应运而生。其中典型的一些产物是

1. Ansible
2. Chef
3. Puppet

实际上这些工具，可能设计上各有所取舍（比如 Pull/Push 模型的取舍），但是其核心的特征不会变化

1. 框架内部提供了常见的比如 SSH 链接管理，多机并行执行，auto retry 等功能
2. 基于上面描述的这一套基础功能，提供了一套 DSL 封装。让开发者更专注于 IaC 的逻辑，而非基础层面的细节
3. 其开源开放，并形成了一套完善的插件机制。社区可以基于这一套提供更丰富的生态。比如 SDN 社区基于 ANSIBLE 提供了各种交换机的 playbook 等

那么截至到现在，实际上 IaC 的发展其实到了一个相对完备的程度。其中不少工具，也依旧贯穿到了现在。

## 新生代的 IaC

从2006年8月25日，Amazon 正式宣布提供了 EC2 服务开始。整个基础设施开始快步向 Cloud 时代迈进。截止到目前，各家云厂商提供了各种各样的服务。通过十多年的演进，也诞生出了诸如 IaaS，PaaS，DaaS，FaaS 等等各种各样的服务模式。这些服务模式，让我们的基础设施的构建，变得更加的简单，更加的快速。但是这些服务模式，也带来了一些新的问题。

可能写到这里，有同学已经能意识到了问题的所在：在获取算力，获取资源越来越快捷的当下。我们怎么样去管理这样一些资源？

那么要解决这样的问题，我们似乎又需要去考虑怎么样用代码或者可声明式的配置来管理这些资源。有没有一点眼熟，历史始终就是一个圈圈.jpg

在起初的时候，我们各自会选择基于各家云厂商提供的 API 与 SDK 自行封装一套 IaC 工具，如同前面所说的一样。这样会带来一些额外的问题：

1. 代码复用性较差
2. 各家都有一套祖传的 IaC 基建，没有统一的行业标准，导致新人入门门槛较高

那么这个时候，云时代的，面向云资源管理的新型 IaC 工具的需求也愈发的迫切。这个时候，Terraform 这样的新型工具应运而生

在 Terraform 里，可能一台 EC2 Instance 的开启可能就是这样的一段简短的定义

```terraform
resource "aws_vpc" "my_vpc" {
  cidr_block = "172.16.0.0/16"

  tags = {
    Name = "tf-example"
  }
}

resource "aws_subnet" "my_subnet" {
  vpc_id            = aws_vpc.my_vpc.id
  cidr_block        = "172.16.10.0/24"
  availability_zone = "us-west-2a"

  tags = {
    Name = "tf-example"
  }
}

resource "aws_network_interface" "foo" {
  subnet_id   = aws_subnet.my_subnet.id
  private_ips = ["172.16.10.100"]

  tags = {
    Name = "primary_network_interface"
  }
}

resource "aws_instance" "foo" {
  ami           = "ami-005e54dee72cc1d00" # us-west-2
  instance_type = "t2.micro"

  network_interface {
    network_interface_id = aws_network_interface.foo.id
    device_index         = 0
  }

  credit_specification {
    cpu_credits = "unlimited"
  }
}
```

这个基础上，我们可以继续将我们诸如 Database，Redis，MQ 等基础设施都进行代码化/描述式配置化，进而提升我们对资源维护的有效性。

同时，随着各家 SaaS 的发展，研发人员也尝试着将这些 SaaS 服务也进行代码化/描述式配置化。以 Terraform 为例，我们可以通过 Terraform 的 Provider 来进行对接。比如 [newrelic](https://newrelic.com/) 提供的 [Provider](https://registry.terraform.io/providers/newrelic/newrelic/latest/docs)，[Bytebase](https://www.bytebase.com/) 提供的 [Provider](https://registry.terraform.io/providers/bytebase/bytebase/latest/docs) 等等

同时，在 IaC 工具帮助我们完成基础设施描述的标准化之后，我们在此基础上能做更多有趣的事情。比如我们可以基于 [Infracost](https://www.infracost.io/) 来计算每次资源变更所带来的资源花费变更。基于 [atlantis](https://www.runatlantis.io/) 来完成集中式的资源变更等等进阶的工作。

那么到现在为止，我们已有的 IaC 产品的选择足够多，能满足我们大部分需求。那么是不是 IaC 整个产品的发展实际上就已经到了一个相对完备的程度呢？答案很明显是否定的

## 未来的 IaC

所以这张主要来聊聊当下 IaC 产品所面临的一些问题，以及我对未来的一些思考吧

### 缺陷一：现有基于 DSL 的语法体系的缺陷

先给大家看一个例子

```terraform
locals {
  dns_records = {
    # "demo0" : 0,
    "demo1" : 1,
    "demo2" : 2
    "demo3" : 3,
  }
  lb_listener_port  = 80
  instance_rpc_port = 9545

  default_target_group_attr = {
    backend_protocol     = "HTTP"
    backend_port         = 9545
    target_type          = "instance"
    deregistration_delay = 10
    protocol_version     = "HTTP1"
    health_check = {
      enabled             = true
      interval            = 15
      path                = "/status"
      port                = 9545
      healthy_threshold   = 3
      unhealthy_threshold = 3
      timeout             = 5
      protocol            = "HTTP"
      matcher             = "200-499"
    }
  }
}

module "alb" {
  source  = "terraform-aws-modules/alb/aws"
  version = "~> 6.0"

  name                       = "alb-demo-internal-rpc"
  load_balancer_type         = "application"
  internal                   = true
  enable_deletion_protection = true


  http_tcp_listeners = [
    {
      protocol           = "HTTP"
      port               = local.lb_listener_port
      target_group_index = 0
      action_type        = "forward"
    }
  ]

  http_tcp_listener_rules = concat([
    for rec, pos in local.dns_records : {
      http_tcp_listener_index = 0
      priority                = 105 + tonumber(pos)
      actions = [
        {
          type               = "forward"
          target_group_index = tonumber(pos)
        }
      ]
      conditions = [
        {
          host_headers = ["${rec}.manjusaka.me"]
        }
      ]

    }
    ], [{
      http_tcp_listener_index = 0
      priority                = 120
      actions = [
        {
          type = "weighted-forward"
          target_groups = [
            {
              target_group_index = 0
              weight             = 95
            },
            {
              target_group_index = 5
              weight             = 4
            },
          ]
        }
      ]
      conditions = [
        {
          host_headers = ["demo0.manjusaka.me"]
        }
      ]
  }])

  target_groups = [
    merge(
      {
        name_prefix = "demo0"
        targets = {
          "demo0-${module.ec2_instance_demo[0].tags_all["Name"]}" = {
            target_id = module.ec2_instance_demo[0].id
            port      = local.instance_rpc_port
          }
        }
      },
      local.default_target_group_attr,
    ),
    merge(
      {
        name_prefix = "demo1"
        targets = {
          "demo1-${module.ec2_instance_demo[0].tags_all["Name"]}" = {
            target_id = module.ec2_instance_demo[0].id
            port      = local.instance_rpc_port
          }
        }
      },
      local.default_target_group_attr,
    ),
    merge(
      {
        name_prefix = "demo2"
        targets = {
          "demo2-${module.ec2_family_c[0].tags_all["Name"]}" = {
            target_id = module.ec2_family_c[0].id
            port      = local.instance_rpc_port
          },
        }
      },
      local.default_target_group_attr,
    ),

    merge(
      {
        name_prefix = "demo3"
        targets = {
          "demo3-${module.ec2_family_d[0].tags_all["Name"]}" = {
            target_id = module.ec2_family_d[0].id
            port      = local.instance_rpc_port
          },
        }
      },
      local.default_target_group_attr,
    ), # target_group_index_3
    merge(
      {
        name_prefix = "demonew"
        targets = {
          "demo0-${module.ec2_instance_reader[0].tags_all["Name"]}" = {
            target_id = module.ec2_instance_reader[0].id
            port      = local.instance_rpc_port
          }
        }
      },
      local.default_target_group_attr,
    ),
  ]
}
```

这段 TF 配置描述虽然看起来长，但是实际上做的事很简单，根据不同的域名 `*.manjusaka.me` 将流量转发到不同的 instance 上。然后对于 `demo0.manjusaka.me` 这个域名，进行单独的流量灰度处理。

我们能发现，Terrafrom 这种 DSL 的解决方案所需要面临的问题就是在对于这种动态灵活的场景下，其表达能力将会有很大的局限性。

社区也充分意识到了这个问题。所以类似 Pulumi 这种基于 Python/Lua/Go/TS 等完整的编程语言的 IaC 产品就应运而生了。比如我们用 Pulumi + Python 改写上面的例子(此处由 ChatGPT 提供技术支持)

```python
from pulumi_aws import alb

dns_records = {
    # "demo0" : 0,
    "demo1": 1,
    "demo2": 2,
    "demo3": 3,
}
lb_listener_port = 80
instance_rpc_port = 9545

default_target_group_attr = {
    "backend_protocol": "HTTP",
    "backend_port": 9545,
    "target_type": "instance",
    "deregistration_delay": 10,
    "protocol_version": "HTTP1",
    "health_check": {
        "enabled": True,
        "interval": 15,
        "path": "/status",
        "port": 9545,
        "healthy_threshold": 3,
        "unhealthy_threshold": 3,
        "timeout": 5,
        "protocol": "HTTP",
        "matcher": "200-499",
    },
}

alb_module = alb.ApplicationLoadBalancer(
    "alb",
    name="alb-demo-internal-rpc",
    load_balancer_type="application",
    internal=True,
    enable_deletion_protection=True,
    http_tcp_listeners=[
        {
            "protocol": "HTTP",
            "port": lb_listener_port,
            "target_group_index": 0,
            "action_type": "forward",
        }
    ],
    http_tcp_listener_rules=[
        {
            "http_tcp_listener_index": 0,
            "priority": 105 + pos,
            "actions": [
                {
                    "type": "forward",
                    "target_group_index": pos,
                }
            ],
            "conditions": [
                {
                    "host_headers": [f"{rec}.manjusaka.me"],
                }
            ],
        }
        for rec, pos in dns_records.items()
    ]
    + [
        {
            "http_tcp_listener_index": 0,
            "priority": 120,
            "actions": [
                {
                    "type": "weighted-forward",
                    "target_groups": [
                        {"target_group_index": 0, "weight": 95},
                        {"target_group_index": 5, "weight": 4},
                    ],
                }
            ],
            "conditions": [{"host_headers": ["demo0.manjusaka.me"]}],
        }
    ],
    target_groups=[
        alb.TargetGroup(
            f"demo0-{module.ec2_instance_demo[0].tags_all['Name'].apply(lambda x: x)}",
            name_prefix="demo0",
            targets=[
                {
                    "target_id": module.ec2_instance_demo[0].id,
                    "port": instance_rpc_port,
                }
            ],
            **default_target_group_attr,
        ),
        alb.TargetGroup(
            f"demo1-{module.ec2_instance_demo[0].tags_all['Name'].apply(lambda x: x)}",
            name_prefix="demo1",
            targets=[
                {
                    "target_id": module.ec2_instance_demo[0].id,
                    "port": instance_rpc_port,
                }
            ],
            **default_target_group_attr,
        ),
        alb.TargetGroup(
            f"demo2-{module.ec2_family_c[0].tags_all['Name'].apply(lambda x: x)}",
            name_prefix="demo2",
            targets=[
                {
                    "target_id": module.ec2_family_c[0].id,
                    "port": instance_rpc_port,
                }
            ],
            **default_target_group_attr,
        ),
        alb.TargetGroup(
            f"demo3-{module.ec2_family_d[0].tags_all['Name'].apply(lambda x: x)}",
            name_prefix="demo3",
            targets=[
                {
                    "target_id": module.ec2_family_d[0].id,
                    "port": instance_rpc_port,
                }
            ],
            **default_target_group_attr,
        ),
        alb.TargetGroup(
            f"demo0-{module.ec2_instance_reader[0].tags_all['Name'].apply(lambda x: x)}",
            name_prefix="demonew",
            targets=[
                {
                    "target_id": module.ec2_instance_reader[0].id,
                    "port": instance_rpc_port,
                }
            ],
            **default_target_group_attr,
        ),
    ],
)

```

你看，整体的用法是不是更贴近于我们的使用习惯，其表达力也更好

### 缺陷二：和业务需求之间的 Gap

实际上在云时代的 IaC 工具，更多的去解决的是基础设施的存在性的问题。而对于已有基础设施的编排与更合理的利用实际上是存在比较大的 Gap 的。我们怎么样将应用部署到这些基础资源上。怎么样去调度这些资源。实际上是个很值得玩味的一个问题。

实际上可能出乎人们的意料，实际上 Kubernetes/Nomad 实际上就在尝试解决这样的问题。可能有人在思考，什么？这个也算是 IaC 工具？毫无疑问的是嘛，不信你对照一下我们前面列的 IaC 的几个核心特征

1. 最终的产物是 machine readable 的的产物。可能是一份代码，也可能是一份配制文件（YAML 工程师表示认可）
2. 基于 machine readable 的产物，可以进一步依赖已有的 VCS 系统（SVN，Git）等做版本管理（manifest 随着仓库走）
3. 基于 machine readable 的产物，可以进一步依赖已有的 CI/CD 系统（Jenkins，Travis CI）等做持续集成/持续交付（argocd 等平台提供了进一步的支持）

同时我们在对应的配置文件里，可以声明我们所需要 CPU/Mem，需要的磁盘/远程盘，需要的网关等。同时这一套框架实际上将计算 Infra 进行了一个相对通用性的抽象，让业务百分之八十的场景下并不需要去考虑底层 Infra 的细节。

但是实际上这套已经存在的方案又会存在一些问题。比如其复杂度的飙升，self-hosted 的运维成本，以及一些抽象泄漏带来的问题。

### 缺陷三：质量性的偏差

云时代新生的 IaC，其 scope 相较于传统的诸如 ansible 之类的 IaC 工具范围更大，野心也更大。所带来的副作用就是其质量的偏差。这个话题可以分为两方面说

第一点来看，诸如 Terraform 这样的 IaC 工具，通过官方提供的 Provider 实现了对 AWS/Azure/GCP 等平台的支持。但是即便是官方支持，其 Provider 里设计的一些逻辑，和平台侧在交互式界面里的设计逻辑并不一致。比如我之前吐槽过“比如 Aurora DB Instance 的 delete protection 在 Console 创建时默认打开，而 TF 里是默认关闭”。这实际上会在使用的时候，给开发者带来额外的心智负担

第二点来看，IaC 工具极度依赖社区（此处的社区饱含开源社区和各类商业公司）。不同于 Ansible 等老前辈，其周边设施的质量相对稳定。Terraform 等新生代的 IaC 周边的质量一言难尽。比如国内诸如福报云，华为云，腾讯云等厂商提供的 Provider 一直被人诟病。而不少大型的面向研发者的 SaaS 平台没有官方提供的 Provider 等（比如 Newrelic）

同时，云厂商所提供的一些功能实际上是和通用性 IaC 工具所冲突的。比如 AWS 的 WAF 工具，其中有一个功能是基于 IPSet 进行拦截，这个时候如果 IPSet 非常大，那么使用通用性的 IaC 工具进行描述将会是一个灾难性的存在。这个时候对于类似的场景，只能基于云厂商自己的 SDK 进行封装，云厂商提供的 SDK 质量合格还好。如果像福报云这样的神奇的 SDK 设计的话，那就只能自求多福了。。

### 缺陷四：面对开发者体验的不足

开发者体验实际上现在是一个比较热门的话题。毕竟没有人愿意将自己宝贵的生命来做重复的工作。就目前而言，主要的 IaC 工具都是 For Production Server 的，而不是 For Developer Experience 的，导致我们用的时候，其体验就很一般。

比如我们现在有一个场景，我们需要在 AWS 上给研发的同学批量开一批 EC2 Instance 作为开发机。怎么样保证研发同学在这些机器上开箱即用，就是很大的一个问题。

虽然我们可以通过预制镜像等方式提供相对统一的环境。不过我们可能会需要更进一步的去细调环境的话，那么就会比较蛋疼。

针对于类似的场景，老一点的有 Nix，新一点的有 [envd](https://github.com/tensorchord/envd) 来解决这样一些问题。但是目前来讲，还是和已有的 IaC 产品有一些 gap。后续怎么样进行对接可能会是个很有趣的话题。

### 缺陷五：面对新型技术栈的一些不足

最典型的是 Serverless 的场景。比如我举个例子，我现在有个简单的需求，就是用 Lambda 来实现一个简单的 SSR 的渲染

```typescript
export default function BlogPosts({ posts }) {
  return posts.map(post => <BlogPost key={post.id} post={post} />)
}

export async function getServerSideProps() {
  const posts = await getBlogPosts();
  return {
    props: { posts }
  }
}
```

函数本身非常简单，但是如果我们要将这个函数部署到 Production Enviorment 里将会是一个比较麻烦的事。比如我们来思考下我们现在需要为这个简单的函数准备什么样的 infra

1. 一个 lambda 实例
2. 一个 S3 bucket
3. 一个 APIGateway 及路由规则
4. 接入 CDN （可选）
5. DNS 准备

那么在 IaC Manifest + 业务代码彼此分离的情况下，我们的变更以及资源的管理将会是一个很大的问题。Vercel 在最近的 Blog [Framework-defined infrastructure](https://vercel.com/blog/framework-defined-infrastructure) 也描述了这样的问题。我们怎么样能进一步发展为 Domain Code as Infrastructure 将会是未来的一个挑战

## 总结

这篇文章写了两天，差不多作为自己对于 IaC 这个事物的一些碎碎念（而不是 Terraform Tutorial！（逃。祝大家读的开心
