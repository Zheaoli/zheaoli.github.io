---
title: 简单安利 Rime 输入法
type: tags
date: 2020-01-28 12:00:00
tags: [工具,输入法]
categories: [工具,输入法,Rime]
toc: true
---

唉，最近因为气胸大过年的住院，春节颓废了好久，今天开始回北京，干脆来安利一个输入法-- Rime

<!--more-->

## 碎碎念

如同大多数人一样，我之前也是使用搜狗输入法作为自己的主力输入法，但是搜狗输入法的一些缺陷让我放弃了使用搜狗输入法

1. 作为传统艺能，搜狗输入法隐私保护成迷，在 MacOS 上某几个版本的搜狗在寻求获取我的通讯录和日历读取权限

2. 作为传统艺能，搜狗输入法的广告推送实在是一言难尽，特别是在 Windows 上，已经禁了一些组件，但是还是防不胜防

3. 因为和港澳台和国外社区朋友的交流需要，我需要输入法能够比较好的支持繁体，而搜狗输入法的繁体支持也是一言难尽

4. 搜狗输入法的定制能力也着实不满足我的需求。。

因此我在18年开始在寻求一种开源，可控，可定制，对简/繁输入都比较友好的输入法。经过寻找之后，Rime 输入法进入了我的视线，经过一年多的使用，我觉得这个真的是一款非常棒的输入法

## Rime 是什么？

`Rime` （又名 `中州韻`）是一款开源的跨平台的输入法引擎，完全开源，完全可定制，你甚至可以基于 [Rime](https://github.com/rime) 的源码，来封装一套自己的输入法引擎。同时因为 `Rime` 极其高的定制性，你可以基于 `Rime` 制作自己的输入法。

`Rime` 的优势主要在于通过配置文件的方式，对扩展提供了极好的支持，而且繁体支持非常棒

举个例子

![非常好的繁体支持](https://user-images.githubusercontent.com/7054676/73233134-98204780-41c0-11ea-92a0-1476e13a3513.png)

在这里，「才」「纔」不一樣。还有很多的例子，大家可以自行体验。

但是 `Rime` 成也极高的定制性，败也极高的定制性，对于使用者而言，纯 YAML 配置文件的定制方式，准入门槛太高

## 让你的 Rime 更好用

首先上一下我的 Rime 配置的效果

![](https://user-images.githubusercontent.com/7054676/73233509-b8043b00-41c1-11ea-9ed4-84fd3defb3cc.png)

![](https://user-images.githubusercontent.com/7054676/73233538-cf432880-41c1-11ea-9365-f94d5d4942cf.png)

![](https://user-images.githubusercontent.com/7054676/73233565-e124cb80-41c1-11ea-840e-4298cf21c5b2.png)

![](https://user-images.githubusercontent.com/7054676/73233572-e84bd980-41c1-11ea-96e6-9eeff08f167c.png)

![](https://user-images.githubusercontent.com/7054676/73233587-f0a41480-41c1-11ea-94e0-a1c8807ed470.png)

![](https://user-images.githubusercontent.com/7054676/73233626-07e30200-41c2-11ea-8993-74daed08c45d.png)

好了，我们开始来聊聊怎么安装配置 `Rime`

### Rime 基础安装

没啥好说的，从[官网](https://rime.im/download/) 下载对应平台的安装包安装即可，在 MacOS 下，`Rime` 的配置在 `~/Library/Rime` 下，大家可以用 VSCode 之类的文本编辑器打开对应的目录，进行编辑

官方并不建议直接修改原始的配置文件，因为输入法更新时会重新覆盖默认配置，可能导致某些自定义配置丢失；推荐作法是创建一系列的 patch 配置，通过类似打补丁替换这种方式来实现无感的增加自定义配置；

### Rime 配色

`Rime` 的配色管理文件是 `squirrel.custom.yaml`，我自己使用了网友贡献的[即刻黄](https://github.com/ryekee/rime-color-scheme)配色

想要切换皮肤配色只需要修改 style/color_scheme 为相应的皮肤配色名称既可

```yaml
patch:
  app_options:
    "com.runningwithcrayons.Alfred-3":
      ascii_mode: true
    com.google.android.studio:
      ascii_mode: true
    com.jetbrains.intellij:
      ascii_mode: true

  show_notifications_when: appropriate # 状态通知，适当(appropriate)，开（always）关（never）

  style:
    color_scheme: jike
  preset_color_schemes:
    apathy:
      name: "冷漠 / Apathy"
      author: "LIANG Hai "
      horizontal: true # 水平排列
      inline_preedit: true #单行显示，false双行显示
      candidate_format: "%c\u2005%@\u2005" # 编号 %c 和候选词 %@ 前后的空间
      corner_radius: 5 #候选条圆角
      border_height: 0
      border_width: 0
      back_color: 0xFFFFFF #候选条背景色
      font_face: "PingFangSC-Regular,HanaMinB" #候选词字体
      font_point: 16 #候选字词大小
      text_color: 0x424242 #高亮选中词颜色
      label_font_face: "STHeitiSC-Light" #候选词编号字体
      label_font_point: 12 #候选编号大小
      hilited_candidate_text_color: 0xEE6E00 #候选文字颜色
      hilited_candidate_back_color: 0xFFF0E4 #候选文字背景色
      comment_text_color: 0x999999 #拼音等提示文字颜色
    jike:
      name: 即刻黄
      author: Ryekee
      back_color: 0x11E4FF
      corner_radius: 5 #候选条圆角
      border_height: 0
      border_width: 0
      candidate_format: "%c\u2005%@\u2005"
      candidate_text_color: 0x362915
      comment_text_color: 0x000000
      font_face: "PingFangSC-Regular,HanaMinB"
      font_point: 16 #候选字词大小
      hilited_candidate_back_color: 0xF4B95F
      hilited_candidate_text_color: 0xFFFFFF
      horizontal: true
      inline_preedit: true
      label_font_face: "STHeitiSC-Light"
      label_font_point: 12
      text_color: 0xFFFFFF
```

### Rime 快捷键字符

在 `Rime` 中，可以设置一些快捷键帮助输入一些特殊字符和表情。默认自带了很多，

比如输入 `/bg` 会给出八卦图案的列表

![八卦](https://user-images.githubusercontent.com/7054676/73234311-6e691f80-41c4-11ea-9855-2c3c11768027.png)

比如输入 `/xl` 会给出希腊字符的列表

![希腊字符](https://user-images.githubusercontent.com/7054676/73234337-8f317500-41c4-11ea-80c2-91cec9c2480b.png)

更多的快捷输入可以参看 `symbols.yaml` 下的列表，其中一些比较好玩的给大家看看

```yaml
#月份、日期、曜日等
    '/yf': [ ㋀, ㋁, ㋂, ㋃, ㋄, ㋅, ㋆, ㋇, ㋈, ㋉, ㋊, ㋋ ]
    '/rq': [ ㏠, ㏡, ㏢, ㏣, ㏤, ㏥, ㏦, ㏧, ㏨, ㏩, ㏪, ㏫, ㏬, ㏭, ㏮, ㏯, ㏰, ㏱, ㏲, ㏳, ㏴, ㏵, ㏶, ㏷, ㏸, ㏹, ㏺, ㏻, ㏼, ㏽, ㏾ ]
    '/yr': [ 月, 火, 水, 木, 金, 土, 日, ㊊, ㊋, ㊌, ㊍, ㊎, ㊏, ㊐, ㊗, ㊡, ㈪, ㈫, ㈬, ㈭, ㈮, ㈯, ㈰, ㈷, ㉁, ㉀ ]
#時間
    '/sj': [ ㍘, ㍙, ㍚, ㍛, ㍜, ㍝, ㍞, ㍟, ㍠, ㍡, ㍢, ㍣, ㍤, ㍥, ㍦, ㍧, ㍨, ㍩, ㍪, ㍫, ㍬, ㍭, ㍮, ㍯, ㍰ ]
#天干、地支、干支
    '/tg': [ 甲, 乙, 丙, 丁, 戊, 己, 庚, 辛, 壬, 癸 ]
    '/dz': [ 子, 丑, 寅, 卯, 辰, 巳, 午, 未, 申, 酉, 戌, 亥 ]
    '/gz': [ 甲子, 乙丑, 丙寅, 丁卯, 戊辰, 己巳, 庚午, 辛未, 壬申, 癸酉, 甲戌, 乙亥, 丙子, 丁丑, 戊寅, 己卯, 庚辰, 辛巳, 壬午, 癸未, 甲申, 乙酉, 丙戌, 丁亥, 戊子, 己丑, 庚寅, 辛卯, 壬辰, 癸巳, 甲午, 乙未, 丙申, 丁酉, 戊戌, 己亥, 庚子, 辛丑, 壬寅, 癸卯, 甲辰, 乙巳, 丙午, 丁未, 戊申, 己酉, 庚戌, 辛亥, 壬子, 癸丑, 甲寅, 乙卯, 丙辰, 丁巳, 戊午, 己未, 庚申, 辛酉, 壬戌, 癸亥 ]
#節氣
    '/jq': [ 立春, 雨水, 驚蟄, 春分, 清明, 穀雨, 立夏, 小滿, 芒種, 夏至, 小暑, 大暑, 立秋, 處暑, 白露, 秋分, 寒露, 霜降, 立冬, 小雪, 大雪, 冬至, 小寒, 大寒 ]
#單位
    '/dw': [ Å, ℃, ％, ‰, ‱, °, ℉, ㏃, ㏆, ㎈, ㏄, ㏅, ㎝, ㎠, ㎤, ㏈, ㎗, ㎙, ㎓, ㎬, ㏉, ㏊, ㏋, ㎐, ㏌, ㎄, ㎅, ㎉, ㎏, ㎑, ㏍, ㎘, ㎞, ㏎, ㎢, ㎦, ㎪, ㏏, ㎸, ㎾, ㏀, ㏐, ㏓, ㎧, ㎨, ㎡, ㎥, ㎃, ㏔, ㎆, ㎎, ㎒, ㏕, ㎖, ㎜, ㎟, ㎣, ㏖, ㎫, ㎳, ㎷, ㎹, ㎽, ㎿, ㏁, ㎁, ㎋, ㎚, ㎱, ㎵, ㎻, ㏘, ㎩, ㎀, ㎊, ㏗, ㏙, ㏚, ㎰, ㎴, ㎺, ㎭, ㎮, ㎯, ㏛, ㏜, ㎔, ㏝, ㎂, ㎌, ㎍, ㎕, ㎛, ㎲, ㎶, ㎼ ]
#貨幣
    '/hb': [ ￥, ¥, ¤, ￠, ＄, $, ￡, £, ৳, ฿, ₠, ₡, ₢, ₣, ₤, ₥, ₦, ₧, ₩, ₪, ₫, €, ₭, ₮, ₯, ₰, ₱, ₲, ₳, ₴, ₵, ₶, ₷, ₸, ₹, ₺, ₨, ﷼ ]
```

而我参考[漠然](https://mritd.me/2019/03/23/oh-my-rime/)的配置，在 `luna_pinyin_simp.custom.yaml` 中添加了一些配置

```yaml
  punctuator:
    import_preset: symbols
    symbols:
      "/fs": [½,‰,¼,⅓,⅔,¾,⅒]
      "/dq": [🌍,🌎,🌏,🌐,🌑,🌒,🌓,🌔,🌕,🌖,🌗,🌘,🌙,🌚,🌛,🌜,🌝,🌞,⭐,🌟,🌠,⛅,⚡,❄,🔥,💧,🌊]
      "/jt": [⬆,↗,➡,↘,⬇,↙,⬅,↖,↕,↔,↩,↪,⤴,⤵,🔃,🔄,🔙,🔚,🔛,🔜,🔝]
      "/sg": [🍇,🍈,🍉,🍊,🍋,🍌,🍍,🍎,🍏,🍐,🍑,🍒,🍓,🍅,🍆,🌽,🍄,🌰,🍞,🍖,🍗,🍔,🍟,🍕,🍳,🍲,🍱,🍘,🍙,🍚,🍛,🍜,🍝,🍠,🍢,🍣,🍤,🍥,🍡,🍦,🍧,🍨,🍩,🍪,🎂,🍰,🍫,🍬,🍭,🍮,🍯,🍼,🍵,🍶,🍷,🍸,🍹,🍺,🍻,🍴]
      "/dw": [🙈,🙉,🙊,🐵,🐒,🐶,🐕,🐩,🐺,🐱,😺,😸,😹,😻,😼,😽,🙀,😿,😾,🐈,🐯,🐅,🐆,🐴,🐎,🐮,🐂,🐃,🐄,🐷,🐖,🐗,🐽,🐏,🐑,🐐,🐪,🐫,🐘,🐭,🐁,🐀,🐹,🐰,🐇,🐻,🐨,🐼,🐾,🐔,🐓,🐣,🐤,🐥,🐦,🐧,🐸,🐊,🐢,🐍,🐲,🐉,🐳,🐋,🐬,🐟,🐠,🐡,🐙,🐚,🐌,🐛,🐜,🐝,🐞,🦋]
      "/bq": [😀,😁,😂,😃,😄,😅,😆,😉,😊,😋,😎,😍,😘,😗,😙,😚,😇,😐,😑,😶,😏,😣,😥,😮,😯,😪,😫,😴,😌,😛,😜,😝,😒,😓,😔,😕,😲,😷,😖,😞,😟,😤,😢,😭,😦,😧,😨,😬,😰,😱,😳,😵,😡,😠]
      "/ss": [💪,👈,👉,👆,👇,✋,👌,👍,👎,✊,👊,👋,👏,👐]
      "/dn": [⌘, ⌥, ⇧, ⌃, ⎋, ⇪, , ⌫, ⌦, ↩︎, ⏎, ↑, ↓, ←, →, ↖, ↘, ⇟, ⇞]
      "/fh": [©,®,℗,ⓘ,℠,™,℡,␡,♂,♀,☉,☊,☋,☌,☍,☑︎,☒,☜,☝,☞,☟,✎,✄,♻,⚐,⚑,⚠]
      "/xh": [＊,×,✱,★,☆,✩,✧,❋,❊,❉,❈,❅,✿,✲]
```

### 设置输入法

大家可以在 `default.custom.yaml` 中设置自己喜欢的输入法，我目前使用的是明月拼音，默认切换输入法的快捷键是 `Ctrl+~` 但是因为这个快捷键和 VSCode 快捷键冲突，所以我将其改为 `Ctrl+Shift+F12` 

```yaml
patch:
  menu:
    page_size: 8
  schema_list:
  - schema: luna_pinyin_simp      # 朙月拼音 简化字
  "switcher/hotkeys":
  - "Control+Shift+F12"
```

### 调教词库

这里引用[漠然](https://mritd.me/2019/03/23/oh-my-rime/)的讲解：

> Rime 默认的词库稍为有点弱，我们可以下载一些搜狗词库来进行扩展；不过搜狗词库格式默认是无法解析的，好在有人开发了工具可以方便的将搜狗细胞词库转化为 Rime 的格式(工具点击这里下载)；目前该工具只支持 Windows(也有些别人写的 py 脚本啥的，但是我没用)，所以词库转换这种操作还得需要一个 Windows 虚拟机；
> 转换过程很简单，先从搜狗词库下载一系列的 scel 文件，然后批量选中，接着调整一下输入和输出格式点击转换，最后保存成一个 txt 文本
> 光有这个文本还不够，我们要将它塞到词库的 yaml 配置里，所以新建一个词库配置文件 luna_pinyin.sougou.dict.yaml，然后写上头部说明(注意最后三个点后面加一个换行)

```yaml
# Rime dictionary
# encoding: utf-8
# 搜狗词库 目前包含如下:
# IT计算机 实用IT词汇 亲戚称呼 化学品名 数字时间 数学词汇 淘宝词库 编程语言 软件专业 颜色名称 程序猿词库 开发专用词库 搜狗标准词库
# 摄影专业名词 计算机专业词库 计算机词汇大全 保险词汇 最详细的全国地名大全 饮食大全 常见花卉名称 房地产词汇大全 中国传统节日大全 财经金融词汇大全

---
name: luna_pinyin.sougou
version: "1.0"
sort: by_weight
use_preset_vocabulary: true
...
```

> 接着只需要把生成好的词库 txt 文件内容粘贴到三个点下面既可；但是词库太多的话你会发现这个文本有好几十 M，一般编辑器打开都会卡死，解决这种情况只需要用命令行 cat 一下就行

```bash
cat sougou.txt >> luna_pinyin.sougou.dict.yaml
```

>最后修改 luna_pinyin.extended.dict.yaml 中的 import_tables 字段，加入刚刚新建的词库既可

```yaml
---
name: luna_pinyin.extended
version: "2016.06.26"
sort: by_weight  #字典初始排序，可選original或by_weight
use_preset_vocabulary: true
#此處爲明月拼音擴充詞庫（基本）默認鏈接載入的詞庫，有朙月拼音官方詞庫、明月拼音擴充詞庫（漢語大詞典）、明月拼音擴充詞庫（詩詞）、明月拼音擴充詞庫（含西文的詞彙）。如果不需要加載某个詞庫請將其用「#」註釋掉。
#雙拼不支持 luna_pinyin.cn_en 詞庫，請用戶手動禁用。

import_tables:
  - luna_pinyin
  # 加入搜狗词库
  - luna_pinyin.sougou
  - luna_pinyin.poetry
  - luna_pinyin.cn_en
  - luna_pinyin.kaomoji
```

在我的配置中，我加入了来自搜狗的医学，古诗词，军事等词库（逃

### 快捷键设置

这里参考了 `Rime` 作者的一个 [Gist](https://gist.github.com/lotem/2981316) 对快捷键做了一些配置

```yaml
  ascii_composer/good_old_caps_lock: true
  ascii_composer/switch_key:
    Caps_Lock: commit_code
    Control_L: noop
    Control_R: noop
    # 按下左 shift 英文字符直接上屏，不需要再次回车，输入法保持英文状态
    Shift_L: commit_code
    Shift_R: noop
```

## 总结

经过这一系列折腾下来，我们 `Rime` 应该就能满足我们日常的使用了，文中的配置都可以直接用我放在 GitHub 上的配置实现开箱即用 [RimeConfig](https://github.com/Zheaoli/RimeConfig)

可能有人想问，为什么对于一个输入法都需要这么多的时间进行调教？是这样，我觉得对于一些关系我们日常使用的基础工具，花一定量的时间去寻找合适自己，并且将其按照的自己的需求进行调教，是一件非常有意义的事。在后续的工作生活学习中，这也将极大的提升我们的幸福感与效率

嗯差不多这样吧，新年第一篇文章，祝大家新年快乐！