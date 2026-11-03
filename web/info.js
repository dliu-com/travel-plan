'use strict';

// The /docs (technical architecture), /docs/cost and /docs/security pages. All text is set through textContent (via PlanDiagram and el), never as HTML.
window.PlanInfo = (() => {
  const D = () => window.PlanDiagram;
  const REVIEWED = { zh: '2026 年 11 月 3 日', en: '3 November 2026' };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function link(href, text, external) {
    const a = el('a', '', text);
    a.href = href;
    if (external) a.rel = 'noopener noreferrer';
    return a;
  }
  function list(items, className = '') {
    const ul = el('ul', className);
    for (const item of items) ul.append(el('li', '', item));
    return ul;
  }
  function section(title, ...children) {
    const node = el('section', 'info-section');
    node.append(el('h2', '', title), ...children);
    return node;
  }
  const TABS = (t) => [['/docs', t('技术架构', 'Technical architecture')], ['/docs/cost', t('运行成本', 'Cost')], ['/docs/security', t('安全', 'Security')], ['/docs/api', 'API']];
  function tabs(t, current) {
    const nav = el('nav', 'dl-tabs');
    nav.setAttribute('aria-label', t('文档章节', 'Docs sections'));
    for (const [path, label] of TABS(t)) {
      const a = link(path, label);
      if (path === current) a.setAttribute('aria-current', 'page');
      nav.append(a);
    }
    return nav;
  }
  function readMore(t, cards) {
    const grid = el('div', 'info-cards');
    for (const c of cards) {
      const a = el('a', 'info-card');
      a.href = c.href;
      const text = el('span', 'info-card-text');
      text.append(el('strong', '', c.title), el('span', '', c.text), el('span', 'info-card-key', `${t('查看', 'Read')} →`));
      a.append(D().icon(c.icon, 'large'), text);
      grid.append(a);
    }
    return grid;
  }

  // ---------------------------------------------------------------- Technical architecture
  function architecture(t) {
    const { stats, tiers, flow, more } = D();
    const page = el('article', 'dl-docs');
    page.append(
      el('h1', '', t('技术架构', 'Technical architecture')),
      el('p', 'lead', t(
        'DL 旅行计划是一个私人行程规划网站：按天安排行程、标注确认状态、附上预订单和照片，再通过链接和同行的朋友一起编辑。网站完全运行在 AWS 无服务器服务上，空闲时不占用任何服务器。',
        'DL Travel Plan is a private travel planner: lay out each day, mark what is confirmed, attach bookings and photos, and share a link so travel companions can edit too. It runs entirely on AWS serverless services, so nothing is running when nobody is using it.',
      )),
      stats([
        ['0', t('空闲时运行的服务器', 'servers running when idle'), 'power'],
        ['≈ $0', t('每月费用（免费额度内）', 'a month, inside free tiers'), 'budget'],
        ['1', t('AWS 区域（爱尔兰）', 'AWS region (Ireland)'), 'globe'],
        ['0', t('后端运行时 npm 依赖', 'runtime npm dependencies'), 'stack'],
        ['144 bit', t('分享链接随机令牌', 'random share-link tokens'), 'key'],
        ['50 MB', t('单个附件上限，每个行程 200 个', 'per attachment, 200 per travel plan'), 'file'],
      ]),
    );

    page.append(section(t('系统图与数据流', 'System map and data flows'),
      tiers({
        title: t('系统图', 'System map'),
        rows: [
          { badge: t('用户', 'You'), label: t('浏览器', 'Browser'), nodes: [
            { icon: 'browser', title: t('单页应用', 'Single-page app'), text: t('原生 JavaScript，无框架，中文/English', 'Plain JavaScript, no framework, 中文/English') },
            { icon: 'entra', title: 'Microsoft Entra ID', text: t('dliu.com 组织成员登录', 'Sign-in for dliu.com members') },
          ] },
          { badge: t('边缘', 'Edge'), tone: 'edge', label: 'CloudFront', link: 'HTTPS', nodes: [
            { icon: 'cloudfront', title: t('CDN 分发', 'Distribution'), text: t('仅 HTTPS、TLS 1.2+、安全响应头', 'HTTPS only, TLS 1.2+, security headers') },
            { icon: 'stack', title: 'CloudFront Functions', text: t('/plan/… 地址改写；dl_vid 访客标记', '/plan/… rewrite; dl_vid visitor tag') },
          ] },
          { badge: t('应用', 'App'), tone: 'app', label: t('静态站点与 API', 'Site and API'), link: t('OAC 签名请求', 'OAC-signed requests'), nodes: [
            { icon: 's3', title: t('S3 站点桶', 'S3 site bucket'), text: 'index.html · app.js · style.css' },
            { icon: 'lambda', title: 'Lambda API', text: t('Node.js 22，函数 URL 仅接受 CloudFront', 'Node.js 22, function URL only accepts CloudFront') },
            { icon: 'lambda', title: t('Lambda PDF 导出', 'Lambda PDF export'), text: t('pdfkit 排版，内嵌中文字体，只读数据库', 'pdfkit layout, embedded Chinese font, read-only database') },
          ] },
          { badge: t('数据', 'Data'), tone: 'private', label: t('私有数据', 'Private data'), link: t('IAM 最小权限', 'Least-privilege IAM'), nodes: [
            { icon: 'dynamodb', title: 'DynamoDB', text: t('行程与安排，按需计费，时间点恢复', 'Travel plans and events, on demand, point-in-time recovery') },
            { icon: 's3', title: t('S3 附件桶', 'S3 files bucket'), text: t('私有，仅限签名链接', 'Private, signed URLs only') },
            { icon: 'lock', title: 'SSM Parameter Store', text: t('Entra 客户端密钥（加密）', 'Entra client secret (encrypted)') },
          ] },
          { badge: t('监控', 'Ops'), label: t('日志与流量', 'Logs and traffic'), link: null, nodes: [
            { icon: 'chart', title: 'TrafficMonitor', text: t('CloudFront 访问日志 → raw/plan/', 'CloudFront access logs → raw/plan/') },
            { icon: 'eye', title: 'CloudWatch Logs', text: t('API 错误日志，保留 3 个月', 'API errors, kept for 3 months') },
          ] },
        ],
        note: t(
          '一切都由 AWS CDK（TypeScript）定义，在 eu-west-1 中用一条 make deploy 命令部署。',
          'Everything is defined in AWS CDK (TypeScript) and deployed to eu-west-1 with one make deploy command.',
        ),
      }),
      flow({
        title: t('登录', 'Sign-in'),
        numbered: true,
        steps: [
          { icon: 'user', title: t('点击登录', 'Sign in'), text: t('生成 PKCE、state 和 nonce', 'PKCE, state and nonce are generated') },
          { icon: 'entra', title: 'Microsoft Entra', text: t('用 dliu.com 账号登录', 'Sign in with a dliu.com account') },
          { icon: 'lambda', title: t('回调校验', 'Callback check'), text: t('校验 id_token 签名、租户、受众和 @dliu.com', 'Verifies the id_token signature, tenant, audience and @dliu.com') },
          { icon: 'lock', title: t('会话 Cookie', 'Session cookie'), text: t('HMAC 签名，30 天，HttpOnly', 'HMAC-signed, 30 days, HttpOnly'), tone: 'good' },
        ],
      }),
      flow({
        title: t('分享链接', 'Share link'),
        numbered: true,
        steps: [
          { icon: 'users', title: t('每个行程自带链接', 'Every plan has a link'), text: t('144 位随机令牌', 'A 144-bit random token') },
          { icon: 'link', title: t('朋友打开', 'A friend opens it'), text: '/plan/20261000?token=…' },
          { icon: 'lambda', title: t('API 校验', 'API check'), text: t('令牌必须属于这个行程', 'The token must belong to this travel plan') },
          { icon: 'map', title: t('查看并编辑', 'View and edit'), text: t('仅限这一个行程', 'This one travel plan only'), tone: 'good' },
        ],
        note: t('每个行程创建时就有分享链接，有效期 3 个月。过期后，登录成员点“创建链接”生成新链接；成员也可以随时“重置链接”，旧链接立即失效。', 'Every travel plan gets its share link when it is created, and a link works for 3 months. After that a signed-in member chooses Create link; members can also Reset link at any time, which stops the old link at once.'),
      }),
      flow({
        title: t('附件上传与下载', 'Attachments'),
        numbered: true,
        steps: [
          { icon: 'lambda', title: t('请求上传', 'Ask to upload'), text: t('API 检查大小和数量，返回 15 分钟签名链接', 'API checks size and count, returns a 15-minute signed URL') },
          { icon: 'upload', title: t('直传 S3', 'Straight to S3'), text: t('签名锁定大小和类型，先放 pending/', 'Size and type are signed; lands in pending/') },
          { icon: 'check', title: t('确认', 'Confirm'), text: t('API 核对后移到 trips/<id>/', 'API checks it and moves it to trips/<id>/') },
          { icon: 'file', title: t('打开', 'Open'), text: t('5 分钟签名链接；网页类文件一律下载', '5-minute signed link; web content always downloads'), tone: 'good' },
        ],
        note: t('文件不经过 Lambda，也从不出现在 plan.dliu.com 域名下。未确认的上传 1 天后自动删除。', 'Files never pass through Lambda and are never served from plan.dliu.com. Unconfirmed uploads are deleted after a day.'),
      }),
    ));

    page.append(section(t('更多文档', 'More docs'), readMore(t, [
      { href: '/docs/cost', icon: 'budget', title: t('运行成本', 'Cost'), text: t('每月费用、免费额度，以及被刷流量时最多花多少钱', 'Monthly cost, free tiers, and the most a flood can cost') },
      { href: '/docs/security', icon: 'shield', title: t('安全审查', 'Security review'), text: t('威胁模型、渗透测试结果、代码审查和已接受的风险', 'Threat model, pen-test results, code review and accepted risks') },
      { href: '/docs/api', icon: 'key', title: 'API', text: t('用 Microsoft 访问令牌读写行程', 'Read and edit travel plans with a Microsoft access token') },
    ])));

    page.append(more(t('技术细节', 'Technical details'), list([
      t('基础设施：AWS CDK v2（TypeScript），一个堆栈，区域 eu-west-1；证书在 us-east-1。', 'Infrastructure: AWS CDK v2 (TypeScript), one stack in eu-west-1; the certificate lives in us-east-1.'),
      t('前端：一个 HTML 文件、一个 CSS 文件和三个原生 JavaScript 文件，无构建步骤，无第三方脚本。', 'Front end: one HTML file, one CSS file and three plain JavaScript files. No build step and no third-party scripts.'),
      t('后端：Node.js 22 Lambda（512 MB，15 秒超时），只用 Node 自带模块和 Lambda 运行时自带的 AWS SDK。', 'Back end: a Node.js 22 Lambda (512 MB, 15-second timeout) using only Node built-ins and the AWS SDK that ships with the runtime.'),
      t('PDF 导出：单独的 Lambda（1 GB，30 秒超时），用 pdfkit 排版并内嵌 Noto Sans SC 字体（只嵌入用到的字），带页眉、页脚和页码；不用浏览器引擎，也不访问网络。', 'PDF export: a separate Lambda (1 GB, 30-second timeout) that lays the plan out with pdfkit and an embedded Noto Sans SC font (only the characters used), with a header, footer and page numbers. No browser engine and no network access.'),
      t('S3 签名链接由 API 自己用 SigV4 生成，不额外引入依赖。', 'S3 signed URLs are made by the API itself with SigV4, without extra dependencies.'),
      t('数据：DynamoDB 全局表，按需计费，开启时间点恢复和删除保护；分享令牌通过 GSI 查找。', 'Data: a DynamoDB global table, on demand, with point-in-time recovery and deletion protection; share tokens are looked up through a GSI.'),
      t('行程编号：/plan/YYYYMMNN，即创建年月加两位序号；用条件写入避免重复。', 'Travel plan addresses: /plan/YYYYMMNN, the year and month created plus a two-digit number; conditional writes prevent clashes.'),
      t('测试：Jest 覆盖 API、PDF 导出、存储、验证、S3 签名和 CDK 堆栈；每次部署前自动运行。', 'Tests: Jest covers the API, PDF export, storage, validation, S3 signing and the CDK stack, and runs before every deploy.'),
      t('流量：CloudFront 标准日志（含 Cookie）写入 TrafficMonitor 的 raw/plan/。', 'Traffic: CloudFront standard logs (with cookies) go to TrafficMonitor under raw/plan/.'),
    ])));
    return [tabs(t, '/docs'), page];
  }

  // ---------------------------------------------------------------- Cost
  function cost(t) {
    const { table, callout } = D();
    const page = el('article', 'dl-docs');
    page.append(
      el('h1', '', t('运行成本', 'Cost')),
      el('p', 'lead', t(
        '没有常驻服务器，只按实际使用付费。对几个人用的行程网站，几乎所有用量都在 AWS 永久免费额度内。价格为 AWS 爱尔兰区域（eu-west-1）的公开价格，美元。',
        'There are no always-on servers; it only costs anything when used. For a site a few people use, almost everything stays inside the AWS always-free tiers. Prices are AWS’s public prices for Ireland (eu-west-1), in US dollars.',
      )),
    );
    page.append(section(t('每月费用', 'Monthly cost'),
      el('p', '', t(
        '没有常驻服务器，只按实际使用付费。对几个人用的行程网站，几乎所有用量都在 AWS 永久免费额度内。',
        'There are no always-on servers; it only costs anything when used. For a site a few people use, almost everything stays inside the AWS always-free tiers.',
      )),
      table([t('服务', 'Service'), t('用途', 'What it does'), t('免费额度 / 价格', 'Free tier / price'), t('本站每月', 'This site, monthly')], [
        ['CloudFront', t('HTTPS、缓存、改写', 'HTTPS, caching, rewrites'), t('1 TB 流量 + 1000 万请求；函数 200 万次', '1 TB + 10M requests; 2M function runs'), '$0'],
        ['Lambda', t('API 与 PDF 导出', 'API and PDF export'), t('100 万请求 + 40 万 GB-秒', '1M requests + 400k GB-seconds'), '$0'],
        ['DynamoDB', t('行程数据', 'Travel plan data'), t('按需；25 GB 存储免费', 'On demand; 25 GB storage free'), t('< $0.01', '< $0.01')],
        ['S3', t('网站文件与附件', 'Site files and attachments'), t('约 $0.023 / GB·月', 'about $0.023 per GB-month'), t('按附件量，通常 < $0.05', 'by attachment size, usually < $0.05')],
        [t('数据传出', 'Data out'), t('附件下载', 'Attachment downloads'), t('每月 100 GB 免费', '100 GB a month free'), '$0'],
        ['Route 53', t('plan.dliu.com DNS 记录', 'plan.dliu.com DNS record'), t('与 dliu.com 共用托管区', 'Shared dliu.com zone'), t('共用 $0.50', 'shared $0.50')],
        ['ACM · SSM · Entra ID', t('证书、密钥、登录', 'Certificate, secret, sign-in'), t('免费', 'Free'), '$0'],
        ['CloudWatch Logs', t('API 日志，3 个月', 'API logs, 3 months'), t('5 GB 免费', '5 GB free'), '$0'],
      ]),
      callout('budget', t(
        '预计合计：每月 $0–$0.10。每个行程的附件总共不超过 1 GB（约每月 $0.02）。分享链接每天对每个行程有用量上限（见安全页面），即使链接泄露也只能产生很少的费用。API 最多同时运行 20 个实例，PDF 导出最多 5 个，突发流量无法占满账户里其他网站共用的 Lambda 并发。',
        'Expected total: $0–$0.10 a month. Each travel plan holds at most 1 GB of attachments (about $0.02 a month), and share links have a daily allowance per plan (see Security), so even a leaked link can only cost a little. The API can run at most 20 copies at once and the PDF export 5, so a flood can’t use up the Lambda concurrency shared with the other dliu.com sites.',
      )),
    ));

    page.append(section(t('被刷流量时最多花多少钱', 'The most a flood can cost'),
      el('p', '', t(
        '攻击者可以不停发请求，让账单上涨（“拒绝钱包”攻击）。下表是每小时的最坏情况和限制它的措施。被拒绝的请求最快 2 毫秒处理完（实测：14 天内 494 次调用，计费时长最短 2 毫秒，中位数 10 毫秒），所以 20 个并发最多每秒处理约 1 万个请求。',
        'An attacker can keep sending requests to run up the bill (“denial of wallet”). The table shows the worst case per hour and what caps it. A refused request takes as little as 2 ms (measured: 494 calls over 14 days, shortest billed time 2 ms, median 10 ms), so 20 concurrent copies can answer at most about 10,000 requests a second.',
      )),
      table([t('部分', 'Part'), t('限制措施', 'What caps it'), t('每小时最坏情况', 'Worst case per hour')], [
        [t('API Lambda（网站与托管 API 共用）', 'API Lambda (website and managed API share it)'), t('保留并发 20 × 512 MB：最多 36,000 GB-秒（$0.60）；每秒最多约 1 万次调用 × $0.20/百万', 'Reserved concurrency 20 × 512 MB: at most 36,000 GB-seconds ($0.60); at most about 10,000 calls a second × $0.20 per million'), '≈ $7.80'],
        [t('PDF 导出 Lambda', 'PDF export Lambda'), t('保留并发 5 × 1 GB：最多 18,000 GB-秒（$0.30）；每秒最多约 2,500 次调用', 'Reserved concurrency 5 × 1 GB: at most 18,000 GB-seconds ($0.30); at most about 2,500 calls a second'), '≈ $2.10'],
        ['DynamoDB', t('只有 Lambda 会读写，受上面的并发限制；无令牌的请求不读数据库，格式正确的假令牌只做一次索引查询', 'Only the Lambdas touch it, so the concurrency caps above apply; requests without a token never read it, and a well-formed fake token costs one index lookup'), '≈ $2.60'],
        [t('CloudWatch 日志', 'CloudWatch Logs'), t('只记录警告和错误，不记录每次调用（2026 年 11 月起）', 'Only warnings and errors are logged, not every call (since November 2026)'), '≈ $0'],
        [t('附件下载（S3 流量）', 'Attachment downloads (S3 data out)'), t('只能用登录或分享链接签名；分享链接每个行程每天最多 10 GB（$0.09/GB）', 'Only signed for members or share links; a share link gets at most 10 GB per plan per day ($0.09 per GB)'), t('每个行程每天 ≤ $0.90', '≤ $0.90 per plan per day')],
        [t('托管 API（API Gateway）', 'Managed API (API Gateway)'), t('没有有效令牌的请求由 JWT 授权器直接返回 401，不运行 Lambda，也不受限流影响；只有本租户签发的令牌能通过授权器，这些请求每秒 10 个、突发 20 个，超出返回 429。AWS 没有说明被拒绝的请求是否计费，按全部计费估算（$1.11/百万，账户上限每秒 1 万）', 'Requests without a valid token get 401 from the JWT authoriser without running Lambda, and the throttle does not apply to them. Only tokens issued by your own tenant pass the authoriser; those are capped at 10 a second, bursts of 20, with 429 above that. AWS does not say whether refused requests are billed, so this assumes they all are ($1.11 per million, account limit 10,000 a second)'), t('≈ $40（1 万/秒）', '≈ $40 (at 10,000/s)')],
        ['CloudFront', t('没有上限：没有 WAF。$1.20/百万 HTTPS 请求 + $0.10/百万次函数运行，与攻击者自己发出的流量成正比', 'No cap: there is no WAF. $1.20 per million HTTPS requests + $0.10 per million function runs, in proportion to the attacker’s own traffic'), t('≈ $47（1 万/秒）', '≈ $47 (at 10,000/s)')],
      ]),
      callout('shield', t(
        '有上限的部分（Lambda 和 DynamoDB）合计每小时最多约 $12.50。CloudFront 和 API Gateway 的请求费只随攻击者的流量增长，没有硬上限；AWS Shield Standard（免费、自动）只挡网络层洪水。要设硬上限，需要加 WAF 限速规则（约每月 $6 起，另加每百万请求 $0.60），这需要所有者决定。',
        'The capped parts (Lambda and DynamoDB) add up to at most about $12.50 an hour. CloudFront and API Gateway request charges grow only with the attacker’s traffic and have no hard cap; AWS Shield Standard (free and automatic) only stops network-level floods. A hard cap needs a WAF rate-based rule (from about $6 a month plus $0.60 per million requests), which is the owner’s decision.',
      )),
    ));
    return [tabs(t, '/docs/cost'), page];
  }

  // ---------------------------------------------------------------- Security
  function security(t) {
    const { tiers, table, callout, more } = D();
    const PASS = { text: t('✓ 符合预期', '✓ As expected'), tone: 'pass' };
    const FIXED = { text: t('✓ 已修复', '✓ Fixed'), tone: 'fixed' };
    const LOW = { text: t('低', 'Low'), tone: 'low' };
    const MEDIUM = { text: t('中', 'Medium'), tone: 'medium' };
    const ACCEPTED = t('已接受', 'Accepted');
    const NOV = '2026-11-03';
    const OCT = '2026-10-09';
    const page = el('article', 'dl-docs');
    page.append(
      el('h1', '', t('安全', 'Security')),
      callout('shield', t(
        `${REVIEWED.zh}完成第二次安全审查：威胁建模（STRIDE 和费用攻击）、对线上网站逐个路由的自动化渗透测试，以及逐个处理程序的代码审查。没有发现严重或高危问题；2 个中危（其中 1 个由独立审计发现）和 4 个低危问题已修复并重新测试，其余风险列在下面。第一次审查（2026 年 10 月 9 日）以登录用户身份，用一个测试后已删除的临时行程测试了 XSS、上传和分享链接。`,
        `Second security review on ${REVIEWED.en}: a threat model (STRIDE and denial of wallet), an automated penetration test of every route on the live site, and a code review of every handler. There were no Critical or High findings; 2 Medium (one found by the independent audit) and 4 Low findings were fixed and re-tested, and the remaining risks are listed below. The first review (9 October 2026) tested XSS, uploads and share links as a signed-in user, with a throwaway travel plan that was deleted afterwards.`,
      )),
    );

    // ---- Threat model
    page.append(section(t('要保护什么', 'What needs protecting'),
      table([t('资产', 'Asset'), t('为什么重要', 'Why it matters'), t('存放位置', 'Where it lives')], [
        [t('行程内容和附件', 'Travel plans and attachments'), t('私人行程：日期、住址、预订号、护照扫描等', 'Private travel details: dates, addresses, booking numbers, passport scans'), t('DynamoDB 表；私有 S3 附件桶', 'DynamoDB table; private S3 files bucket')],
        [t('分享令牌', 'Share tokens'), t('拿到令牌就能查看和编辑一个行程', 'Whoever has one can see and edit one travel plan'), t('行程记录；分享链接的网址', 'The travel plan record; share-link URLs')],
        [t('会话和客户端密钥', 'Sessions and the client secret'), t('密钥可伪造任何会话', 'The secret could forge any session'), t('__Host- Cookie；SSM 加密参数', '__Host- cookie; encrypted SSM parameter')],
        [t('Microsoft 访问令牌', 'Microsoft access tokens'), t('可通过托管 API 读写所有行程', 'Can read and change every travel plan through the managed API'), t('调用方的工具里，约一小时有效', 'In the caller’s tool, valid about an hour')],
        [t('AWS 账单和可用性', 'The AWS bill and availability'), t('同一账户里还有其他 dliu.com 网站', 'Other dliu.com sites share the account'), t('Lambda 并发、请求计费', 'Lambda concurrency, per-request charges')],
      ]),
      table([t('角色', 'Actor'), t('能做什么', 'What they can do'), t('不能做什么', 'What they cannot do')], [
        [t('匿名访问者', 'Anonymous visitor'), t('看登录页和这些文档；/api/me 只回答“未登录”', 'See the sign-in page and these docs; /api/me only answers “not signed in”'), t('读取任何行程、附件或分享链接', 'Read any travel plan, file or share link')],
        [t('dliu.com 成员（已登录）', 'dliu.com member (signed in)'), t('查看、创建、编辑、删除所有行程（没有单独的所有者，组织成员彼此信任）', 'See, create, edit and delete every travel plan (there is no per-plan owner; members trust each other)'), t('获得托管 API 权限（需单独分配角色）', 'Use the managed API without the separately assigned role')],
        [t('持分享链接者', 'Share-link holder'), t('查看和编辑一个行程，有每日用量上限', 'See and edit one travel plan, within a daily allowance'), t('列出、新建、删除行程，或打开其他行程', 'List, create or delete travel plans, or open any other one')],
        [t('API 工具（Microsoft 令牌 + api.access 角色）', 'API tool (Microsoft token + api.access role)'), t('按 trip.read / trip.write / trip.delete 权限操作所有行程；读取时得到分享链接', 'Work on every travel plan per its trip.read / trip.write / trip.delete scopes; reading returns the share link'), t('使用网站 Cookie 或分享令牌', 'Use a website cookie or a share token')],
        [t('令牌被盗', 'Stolen credential'), t('会话 Cookie：最多 30 天；分享令牌：最多 3 个月，成员可以随时重置；Microsoft 令牌：约 1 小时', 'Session cookie: up to 30 days; share token: up to 3 months, and members can reset it at any time; Microsoft token: about an hour'), t('超出该凭据本身的范围', 'Go beyond what that credential allows')],
        [t('被入侵的依赖包', 'Compromised dependency'), t('API 函数没有任何 npm 依赖；PDF 函数用 pdfkit，只能读表；网页不加载第三方脚本', 'The API function has no npm dependencies; the PDF function uses pdfkit and can only read the table; pages load no third-party scripts'), t('PDF 函数不能写行程或访问附件桶', 'The PDF function cannot change travel plans or reach the files bucket')],
      ]),
    ));

    page.append(section(t('信任边界与数据流', 'Trust boundaries and data flows'),
      tiers({
        title: t('请求如何穿过各层', 'How a request crosses each layer'),
        rows: [
          { badge: t('不可信', 'Untrusted'), tone: 'untrusted', label: t('互联网', 'Internet'), nodes: [
            { icon: 'users', title: t('组织成员', 'Members'), text: t('登录后可编辑所有行程', 'Signed in; edit every travel plan') },
            { icon: 'link', title: t('持链接的访客', 'Link holders'), text: t('可编辑一个行程，但输入同样不可信', 'Edit one travel plan; their input is still untrusted') },
            { icon: 'bot', title: t('API 工具与攻击者', 'API tools and attackers'), text: t('可以构造任何请求', 'Can send any request') },
          ] },
          { badge: t('边缘', 'Edge'), tone: 'edge', label: 'CloudFront · API Gateway', link: t('仅 HTTPS', 'HTTPS only'), nodes: [
            { icon: 'cloudfront', title: t('网站', 'Website'), text: t('TLS 1.2+、HSTS、CSP 等响应头；/api 不缓存', 'TLS 1.2+, HSTS, CSP and other headers; /api is never cached') },
            { icon: 'key', title: t('托管 API', 'Managed API'), text: t('校验 Microsoft JWT；每秒 10 个、突发 20 个', 'Checks the Microsoft JWT; 10 a second, bursts of 20') },
            { icon: 'lock', title: 'OAC', text: t('S3 和 Lambda 只接受 CloudFront 签名的请求', 'S3 and Lambda only accept CloudFront-signed requests') },
          ] },
          { badge: 'API', tone: 'app', label: 'Lambda', link: t('签名请求', 'Signed request'), nodes: [
            { icon: 'key', title: t('访问控制', 'Access control'), text: t('会话、该行程的令牌，或 API 角色和权限', 'Session, this travel plan’s token, or API role and scope') },
            { icon: 'shield', title: t('请求检查', 'Request checks'), text: t('Origin、JSON、64 KB 上限', 'Origin, JSON, 64 KB limit') },
            { icon: 'check', title: t('输入验证', 'Validation'), text: t('编号格式、长度、日期、链接协议、文件名', 'Id formats, lengths, dates, link schemes, file names') },
            { icon: 'lambda', title: t('PDF 导出', 'PDF export'), text: t('同样的访问控制；独立函数，只读', 'Same access control; separate, read-only function') },
          ] },
          { badge: t('私有', 'Private'), tone: 'private', label: t('数据', 'Data'), link: t('最小权限 IAM', 'Least-privilege IAM'), nodes: [
            { icon: 'dynamodb', title: 'DynamoDB', text: t('仅 API 可写（PDF 导出只读）', 'Only the API writes (PDF export reads)') },
            { icon: 's3', title: t('附件桶', 'Files bucket'), text: t('私有；浏览器直接用 5–15 分钟的签名链接上传下载', 'Private; browsers upload and download directly with 5–15 minute signed URLs') },
            { icon: 'lock', title: 'SSM', text: t('客户端密钥，仅两个函数可读', 'Client secret, readable by the two functions only') },
          ] },
        ],
      }),
    ));

    page.append(section(t('STRIDE：逐个组件的威胁', 'STRIDE: threats per component'),
      el('p', '', t(
        'S 冒充 · T 篡改 · R 抵赖 · I 信息泄露 · D 拒绝服务 · E 权限提升。“剩余风险”是在现有控制措施之后的评估。',
        'S spoofing · T tampering · R repudiation · I information disclosure · D denial of service · E elevation of privilege. “Residual” is the risk left after the controls.',
      )),
      table([t('组件', 'Component'), 'STRIDE', t('威胁', 'Threat'), t('控制措施', 'Controls'), t('剩余风险', 'Residual')], [
        [t('登录（OIDC）', 'Sign-in (OIDC)'), 'S', t('伪造或重放登录', 'Forged or replayed sign-in'), t('授权码 + PKCE S256、state、nonce，存于 10 分钟的 __Host- Cookie；校验 id_token 签名、签发方、受众和租户；只接受 dliu.com 租户和 @dliu.com 用户名', 'Code flow with PKCE S256, state and nonce in a 10-minute __Host- cookie; the id_token signature, issuer, audience and tenant are checked; only the dliu.com tenant and @dliu.com usernames'), LOW],
        [t('会话 Cookie', 'Session cookie'), 'S · E', t('伪造或盗用会话', 'Forged or stolen session'), t('HMAC-SHA256、HttpOnly、Secure、SameSite=Lax、__Host-；无法在服务端撤销，最长 30 天', 'HMAC-SHA256, HttpOnly, Secure, SameSite=Lax, __Host-; cannot be revoked on the server, lasts up to 30 days'), LOW],
        [t('分享链接', 'Share links'), 'I · E', t('猜测、泄露或用到别的行程', 'Guessed, leaked, or used on another plan'), t('144 位随机令牌，常数时间比较；只对一个行程有效，不能列出或删除行程；不存在和无权限的行程得到相同的拒绝；链接 3 个月后失效，成员可以随时重置（本次修复）', '144-bit random token compared in constant time; works for one plan only and cannot list or delete plans; missing and forbidden plans get the same refusal; links expire after 3 months and members can reset them (fixed in this review)'), LOW],
        [t('网站 API', 'Website API'), 'T', t('CSRF 或注入', 'CSRF or injection'), t('写请求要求本站 Origin 和 JSON；编号按正则检查；DynamoDB 使用类型化参数，不拼接查询；界面只用 textContent 显示', 'Writes need this site’s Origin and JSON; ids are checked against patterns; DynamoDB uses typed parameters, never built queries; the UI only uses textContent'), LOW],
        [t('网站 API', 'Website API'), 'R', t('否认做过的修改', 'Denying a change'), t('每个行程记录最后修改人和时间；不记录读取', 'Each plan records its last editor and time; reads are not logged'), LOW],
        [t('API 与 PDF 函数', 'API and PDF functions'), 'I', t('错误信息或日志泄露', 'Leaks through errors or logs'), t('客户端只看到通用错误，没有堆栈；日志里的分享令牌和用户名已去除（本次修复）', 'Clients get generic errors without stacks; share tokens and usernames are kept out of the logs (fixed in this review)'), LOW],
        [t('托管 API', 'Managed API'), 'S · E', t('伪造令牌或无角色的成员', 'Forged tokens, or members without the role'), t('API Gateway 校验签名、签发方、受众、过期和权限；函数再校验客户端（azp）、不可变用户 ID、api.access 角色和权限', 'API Gateway checks the signature, issuer, audience, expiry and scope; the function re-checks the client (azp), the immutable user id, the api.access role and the scope'), LOW],
        [t('托管 API', 'Managed API'), 'D', t('刷请求', 'Flooding'), t('无有效令牌：授权器返回 401，不运行 Lambda；本租户令牌：每秒 10 个、突发 20 个，超出返回 429（本次修复）', 'Without a valid token: 401 from the authoriser, no Lambda. With a token from your tenant: 10 a second, bursts of 20, then 429 (fixed in this review)'), LOW],
        ['Lambda', 'D', t('刷流量耗尽并发或推高账单', 'Floods that use up concurrency or run up the bill'), t('保留并发 20 和 5；分享链接每日用量上限；只记录警告和错误；见“运行成本”', 'Reserved concurrency 20 and 5; daily share-link allowances; only warnings and errors are logged; see Cost'), MEDIUM],
        ['CloudFront', 'T · I', t('缓存投毒或缓存欺骗', 'Cache poisoning or deception'), t('/api 不缓存且 no-store；不信任 X-Forwarded-Host 等头', '/api is uncached and no-store; X-Forwarded-Host and similar headers are not trusted'), LOW],
        [t('附件桶', 'Files bucket'), 'I · T', t('直接访问、篡改上传、上传网页', 'Direct access, tampered uploads, uploaded web pages'), t('阻止所有公开访问；签名锁定大小和类型，5–15 分钟有效；网页类文件强制下载，且来自 S3 域名', 'All public access blocked; signatures fix size and type and last 5–15 minutes; web content is forced to download, from the S3 domain'), LOW],
        [t('附件', 'Attachments'), 'E', t('病毒或伪装扩展名', 'Malware or disguised extensions'), t('清除文件名中的方向控制字符；危险类型只能下载；没有病毒扫描', 'Direction marks are stripped from names; risky types only download; no virus scan'), MEDIUM],
        [t('分享链接访客', 'Share-link guests'), 'T', t('添加钓鱼链接或删除安排', 'Adding phishing links or deleting events'), t('只限持链接者；记录最后修改人；DynamoDB 时间点恢复可回滚 35 天', 'Link holders only; the last editor is recorded; point-in-time recovery can roll back 35 days'), MEDIUM],
        [t('站点桶与 Lambda URL', 'Site bucket and Lambda URLs'), 'S', t('绕过 CloudFront', 'Going around CloudFront'), t('只信任这个分发的 OAC；Lambda URL 需要 IAM 签名', 'Only this distribution’s OAC is trusted; Lambda URLs need IAM signing'), LOW],
        ['DynamoDB · SSM', 'I · E', t('权限过宽', 'Over-broad access'), t('API：本表、本桶和 /travel-plan/ 参数；PDF：只读本表和参数，不能访问附件桶', 'API: this table, this bucket and the /travel-plan/ parameters; PDF: reads the table and parameters only, no files bucket'), LOW],
        [t('依赖包', 'Dependencies'), 'T · E', t('供应链攻击', 'Supply-chain attack'), t('API 函数零依赖；PDF 函数只有 pdfkit，且权限只读；CSP 只允许本站脚本；锁定文件已提交', 'The API function has no dependencies; the PDF function only pdfkit, with read-only rights; the CSP only allows our own scripts; lockfiles are committed'), LOW],
      ]),
      callout('budget', t(
        '费用攻击：有上限的部分（Lambda、DynamoDB）每小时最多约 $12.50；CloudFront 和 API Gateway 的请求费只随攻击者流量增长，没有 WAF 就没有硬上限。详细计算见“运行成本”。',
        'Denial of wallet: the capped parts (Lambda, DynamoDB) cost at most about $12.50 an hour; CloudFront and API Gateway request charges grow only with the attacker’s traffic and have no hard cap without a WAF. The calculation is on the Cost page.',
      )),
    ));
    const costLink = el('p');
    costLink.append(link('/docs/cost', t('查看费用计算 →', 'See the cost calculation →')));
    page.lastChild.append(costLink);

    // ---- Findings
    page.append(section(t(`本次审查的发现（${REVIEWED.zh}）`, `Findings (${REVIEWED.en})`),
      table(['ID', t('严重程度', 'Severity'), t('发现', 'Finding'), t('状态', 'Status')], [
        ['M1', MEDIUM, t('托管 API 没有限流：持有本租户令牌的调用方可以刷请求，让共用的 Lambda 排队（无令牌的请求本来就在授权器被拒绝）', 'The managed API had no throttling: a caller with a token from your tenant could flood it and queue up the shared Lambda (requests without a token were already refused by the authoriser)'), FIXED],
        ['M3', MEDIUM, t('分享链接永久有效且不能重置，而只有 trip.read 权限的 API 调用方也会拿到可编辑的 shareUrl：读取权限变成永久的编辑权限（独立审计发现）。现在链接 3 个月后失效，成员可以随时重置', 'Share links never expired and could not be reset, yet API callers with only trip.read got the editable shareUrl, so read access became permanent edit access (found by the independent audit). Links now expire after 3 months and members can reset them'), FIXED],
        ['L2', LOW, t('出错时，/api/shared/<令牌> 的完整路径会写入错误日志', 'On an error, the full /api/shared/<token> path was written to the error log'), FIXED],
        ['L6', LOW, t('“域名不允许”的警告记录了用户名', 'The “domain not allowed” warning logged the username'), FIXED],
        ['L7', LOW, t('每次调用写 3 行平台日志，刷流量时增加日志费用', 'Every call wrote 3 platform log lines, adding log charges during a flood'), FIXED],
        ['L5', LOW, t('部署用的自定义资源日志组永不过期（只有部署日志）。现在每个日志组都由堆栈管理，保留 3 个月', 'Deploy-time custom-resource log groups never expired (deployment logs only). Every log group is now stack-managed and kept 3 months'), FIXED],
        ['L1', LOW, t('分享令牌在网址中，会进入浏览器历史和私有访问日志', 'Share tokens are in URLs, so they reach browser history and the private access logs'), ACCEPTED],
        ['L3', LOW, t('会话无法在服务端撤销（最长 30 天）', 'Sessions cannot be revoked on the server (up to 30 days)'), ACCEPTED],
        ['L4', LOW, t('只有 trip.read 权限的 API 调用方仍会拿到可编辑的 shareUrl（所有者决定：API 工具都同时有读写权限）', 'API callers with only trip.read still get the editable shareUrl (the owner’s decision: API tools are always given read and write)'), ACCEPTED],
      ]),
    ));

    // ---- Live penetration tests
    page.append(section(t('线上渗透测试', 'Live penetration tests'),
      el('p', '', t(
        `${NOV} 的测试由仓库里的 scripts/pentest.sh 完成：只读、匿名或使用伪造凭据，不需要任何密钥，可以随时重新运行。${OCT} 的测试以登录用户身份进行，使用一个测试后已删除的临时行程。`,
        `The ${NOV} tests are scripts/pentest.sh in the repository: read-only, anonymous or with forged credentials, no secrets needed, and safe to rerun at any time. The ${OCT} tests were run signed in, with a throwaway travel plan deleted afterwards.`,
      )),
      table([t('测试', 'Test'), t('预期', 'Expected'), t('实际', 'Actual'), t('日期', 'Date')], [
        [t('网站 API 每个路由和方法，未登录', 'Every website API route and method, signed out'), t('401；/api/me 返回 200 “未登录”', '401; /api/me returns 200 “not signed in”'), t('相同', 'Same'), NOV],
        [t('伪造签名、过期、alg:none 形式的会话 Cookie；把登录临时 Cookie 当会话用', 'Session cookie with a forged MAC, expired, or shaped like alg:none; the sign-in cookie replayed as a session'), '401', '401', NOV],
        [t('错误或畸形的分享令牌（请求头或 ?token=）', 'Wrong or malformed share token (header or ?token=)'), '403', '403', NOV],
        [t('用分享令牌列出行程', 'Listing travel plans with a share token'), '401', '401', NOV],
        [t('/api/shared 用不存在的令牌', '/api/shared with an unknown token'), '404', '404', NOV],
        [t('同一个错误令牌，访问看似真实和不存在的行程编号', 'The same wrong token on a real-looking and a made-up plan id'), t('完全相同的回答', 'Identical answers'), t('相同', 'Identical'), NOV],
        [t('编号里的 NoSQL 运算符、编码的 ../；静态站点 ../../etc/passwd', 'NoSQL operators and encoded ../ in ids; ../../etc/passwd on the static site'), t('4xx，不返回文件', '4xx, no file'), t('400/403/404，没有文件', '400/403/404, no file'), NOV],
        [t('跳转和退出地址里的 CRLF', 'CRLF in redirect queries and the sign-out return'), t('不注入响应头', 'No injected header'), t('没有', 'None'), NOV],
        [t('外站或缺失的 Origin 发 POST/DELETE', 'POST/DELETE with a foreign or missing Origin'), '403', '403', NOV],
        [t('网站和托管 API 的 CORS（含预检）', 'CORS on the website and managed API (with preflight)'), t('不对外站返回 Access-Control-Allow-Origin', 'No Access-Control-Allow-Origin for other origins'), t('没有', 'None'), NOV],
        [t('退出地址 //evil、https://evil、/\\evil；X-Forwarded-Host', 'Sign-out return //evil, https://evil, /\\evil; X-Forwarded-Host'), t('跳到 /', 'Location /'), '/', NOV],
        [t('登录跳转', 'Sign-in redirect'), t('Microsoft；固定的 redirect_uri；PKCE S256、state、nonce；__Host- HttpOnly Cookie', 'Microsoft; fixed redirect_uri; PKCE S256, state, nonce; __Host- HttpOnly cookie'), t('全部符合', 'All present'), NOV],
        [t('回调缺少或伪造 state', 'Callback with a missing or forged state'), t('400，没有堆栈', '400, no stack'), t('400，没有堆栈', '400, no stack'), NOV],
        [t('托管 API：无令牌、alg:none、伪造 HS256、乱码令牌、网站 Cookie', 'Managed API: no token, alg:none, forged HS256, garbage token, website cookie'), '401', '401', NOV],
        [t('托管 API：/api/shared 和未知路由', 'Managed API: /api/shared and unknown routes'), '404', '404', NOV],
        [t('托管 API：200 个无令牌请求同时发出（HTTP/2）', 'Managed API: 200 requests at once without a token (HTTP/2)'), t('全部由授权器返回 401，没有 5xx', 'All 401 from the authoriser, no 5xx'), t('200 个 401，约 0.2 秒；没有 429，因为限流在授权器之后', '200 × 401 in about 0.2 s; no 429, because the throttle applies after the authoriser'), NOV],
        [t('托管 API 阶段限流（aws apigatewayv2 get-stages）', 'Managed API stage throttle (aws apigatewayv2 get-stages)'), t('每秒 10、突发 20', 'Rate 10, burst 20'), t('相同；带令牌的洪水测试未做（测试不使用凭据）', 'Same; a token-bearing flood was not run (the tests use no credentials)'), NOV],
        [t('未签名直接调用两个 Lambda 函数 URL', 'Calling both Lambda function URLs unsigned'), '403', '403', NOV],
        [t('直接访问站点桶对象和列表、附件桶列表', 'Site bucket object and listing, files bucket listing, directly'), '403', '403', NOV],
        [t('*.cloudfront.net 主机名', 'The *.cloudfront.net host name'), t('与 plan.dliu.com 相同的检查（未登录 401）', 'Same checks as plan.dliu.com (401 signed out)'), '401', NOV],
        [t('缓存：/api 响应头；/api/me/x.css；X-Original-URL', 'Cache: /api headers; /api/me/x.css; X-Original-URL'), t('no-store；404；被忽略', 'no-store; 404; ignored'), t('相同', 'Same'), NOV],
        [t('隐藏文件：/.git/config、/.env、/package.json、/cdk.json、源码映射、/lambda/、/cdk.out/', 'Hidden files: /.git/config, /.env, /package.json, /cdk.json, source maps, /lambda/, /cdk.out/'), '403', '403', NOV],
        [t('缺少 SHA-256 头的请求体；70 KB 请求体；TRACE；对静态文件 PUT', 'Body without its SHA-256 header; a 70 KB body; TRACE; PUT on a static file'), t('403；未解析就 401；405；403', '403; 401 before parsing; 405; 403'), t('相同', 'Same'), NOV],
        [t('TLS 1.0/1.1；HTTP', 'TLS 1.0/1.1; plain HTTP'), t('拒绝；301 到 HTTPS', 'Refused; 301 to HTTPS'), t('相同', 'Same'), NOV],
        [t('响应头', 'Response headers'), t('HSTS；CSP 无 unsafe-*、frame-ancestors \'none\'；nosniff；DENY；Referrer-Policy', 'HSTS; CSP without unsafe-* and with frame-ancestors \'none\'; nosniff; DENY; Referrer-Policy'), t('全部存在', 'All present'), NOV],
        [t('旧网址 /about、/security（带查询）', 'Old URLs /about and /security (with a query)'), t('301 到 /docs、/docs/security，保留查询', '301 to /docs and /docs/security, query kept'), t('相同', 'Same'), NOV],
        [t('存储型 XSS：行程和安排的每个字段（<script>、onerror、onload、模板、Markdown）', 'Stored XSS in every plan and event field (<script>, onerror, onload, templates, Markdown)'), t('显示为文本，不执行', 'Shown as text; nothing runs'), t('纯文本', 'Plain text'), OCT],
        [t('javascript:、data:、vbscript:、file:、// 链接', 'javascript:, data:, vbscript:, file: and // links'), '400', '400', OCT],
        [t('文件名含 HTML、CRLF、引号、RLO 方向字符', 'File names with HTML, CRLF, quotes or RLO marks'), t('纯文本；不注入响应头；去除方向字符', 'Text; no header injection; marks stripped'), t('RLO 曾被保存 → 已修复', 'RLO was stored → fixed'), OCT],
        [t('上传 HTML、SVG、XHTML、UTF-7', 'Uploading HTML, SVG, XHTML, UTF-7'), t('从 S3 域名以 application/octet-stream 下载', 'Download as application/octet-stream from the S3 domain'), t('相同', 'Same'), OCT],
        [t('篡改签名上传：更大、换类型、换对象名、用上传链接下载', 'Tampered signed uploads: larger, other type, other key, GET with the upload URL'), t('S3 返回 403', 'S3 returns 403'), '403', OCT],
        [t('0 字节、60 MB、负数大小、未上传就确认、确认到其他行程', 'Zero bytes, 60 MB, negative size, confirming before upload or into another plan'), t('拒绝', 'Refused'), t('拒绝', 'Refused'), OCT],
        [t('A 行程的令牌用于 B 行程；少一位的令牌', 'Plan A’s token on plan B; a token one character short'), '403', '403', OCT],
        [t('登录后 text/plain 或表单请求体；70 KB 请求体', 'Signed in: text/plain or form body; a 70 KB body'), '415 · 413', '415 · 413', OCT],
        [t('带令牌请求后再匿名请求同一网址', 'An anonymous request after a token request to the same URL'), t('401（不走缓存）', '401 (not cached)'), '401', OCT],
        ['Permissions-Policy', t('禁用摄像头、麦克风、定位、支付、USB', 'Camera, microphone, location, payment, USB disabled'), t('缺失 → 已修复', 'Missing → fixed'), OCT],
        [t('Lambda 并发', 'Lambda concurrency'), t('有上限，不能耗尽其他网站', 'Capped, so other sites are not starved'), t('无上限 → 已修复（20）', 'Uncapped → fixed (20)'), OCT],
      ], 'pentest'),
    ));

    // ---- Code review
    page.append(section(t('代码审查', 'Code review'), list([
      t('逐个阅读了所有处理程序（lambda/api 的 index、access、auth、managed、trips、store、limits、s3，以及 lambda/pdf）：每个路由都经过同一个访问检查；编号、长度、日期、链接和文件名都有验证；出错时只返回通用信息。', 'Read every handler (lambda/api index, access, auth, managed, trips, store, limits and s3, plus lambda/pdf): every route goes through the same access check; ids, lengths, dates, links and file names are validated; errors return generic messages only.'),
      t('密钥：客户端密钥存放在 SSM 加密参数中，运行时读取。gitleaks 8.30.1 扫描全部 git 历史（34 个提交）：没有泄露；工作目录中的命中都在被忽略的 cdk.out 里（误报）。', 'Secrets: the client secret is an encrypted SSM parameter read at run time. gitleaks 8.30.1 over the whole git history (34 commits): no leaks; the working-tree hits are all in the git-ignored cdk.out (false positives).'),
      t('npm audit：lambda/api 没有依赖；lambda/pdf 生产依赖 0 个问题；根目录生产依赖 2 个中危（aws-cdk-lib 内置的 minimatch，只在部署时运行，暂无修复）；开发依赖 22 个（4 低、18 中），都在 Jest 工具链，不会部署。', 'npm audit: lambda/api has no dependencies; lambda/pdf production: 0; root production: 2 moderate (minimatch bundled in aws-cdk-lib, only runs at deploy time, no fix yet); root development: 22 (4 low, 18 moderate), all in the Jest tool chain and never deployed.'),
      t('IAM：每个函数只拿到自己需要的表、桶和参数（见下方“防护细节”）。', 'IAM: each function only gets the table, bucket and parameters it needs (see Control details below).'),
      t('存储：两个桶都阻止所有公开访问、SSE-S3 加密、禁用 ACL、拒绝非 TLS 请求；站点桶只允许这个 CloudFront 分发读取。DynamoDB 使用 AWS 托管密钥加密，开启删除保护和时间点恢复。', 'Storage: both buckets block all public access, use SSE-S3 encryption, disable ACLs and refuse non-TLS requests; the site bucket only lets this CloudFront distribution read it. DynamoDB is encrypted with an AWS-owned key and has deletion protection and point-in-time recovery.'),
      t('日志：所有日志组（包括 CDK 的部署辅助函数）保留 3 个月（90 天），JSON 格式，只记录警告和错误；不记录分享令牌、用户名或请求内容。', 'Logs: every log group, including CDK’s deployment helper functions, is kept 3 months (90 days); JSON, warnings and errors only; no share tokens, usernames or request bodies.'),
      t('测试：Jest 覆盖登录、会话、CSRF、分享令牌、托管 API 的令牌声明、上传签名、日志脱敏，以及堆栈里的限流、日志保留、响应头和改写规则；每个修复都有回归测试。', 'Tests: Jest covers sign-in, sessions, CSRF, share tokens, managed API token claims, upload signing and log redaction, plus the stack’s throttling, log retention, headers and rewrites; every fix has a regression test.'),
    ])));

    page.append(section(t('已接受的风险', 'Accepted residual risks'), list([
      t('持分享链接的人可以编辑或删除安排、添加链接和上传文件，直到链接过期（3 个月）或被成员重置。只把链接发给信任的人。', 'Anyone with a share link can edit or delete events, add links and upload files until the link expires (3 months) or a member resets it. Only send links to people you trust.'),
      t('令牌在网址中，会出现在浏览器历史和私有的 CloudFront/TrafficMonitor 访问日志里。', 'Tokens are in the URL, so they appear in browser history and in the private CloudFront and TrafficMonitor access logs.'),
      t('没有 WAF：CloudFront 和 API Gateway 的请求费没有硬上限（见“运行成本”）。加 WAF 需要所有者决定。下载链接在 5 分钟内可重复使用。', 'There is no WAF, so CloudFront and API Gateway request charges have no hard cap (see Cost); adding one is the owner’s decision. A download link can be reused for 5 minutes.'),
      t('附件没有病毒扫描；附件桶没有版本控制，被访客覆盖或删除的附件无法恢复。', 'Attachments are not virus-scanned, and the files bucket has no versioning, so an attachment a guest replaces or deletes cannot be recovered.'),
      t('会话无法在服务端撤销：被移出组织的成员最多还能用 30 天。轮换 Entra 客户端密钥会让所有人立即退出。', 'Sessions cannot be revoked on the server: someone removed from the organisation keeps access for up to 30 days. Rotating the Entra client secret signs everyone out at once.'),
      t('退出登录是 GET 请求，其他网站可以让你退出（影响很小）。', 'Sign-out is a GET request, so another site could sign you out (low impact).'),
      t('HSTS 未包含子域名，以免影响 dliu.com 的其他网站。', 'HSTS does not include subdomains, so other dliu.com sites are not affected.'),
      t('访问不存在的静态文件时显示 S3 的 403 XML（无敏感信息）。', 'Missing static files show S3’s 403 XML page (nothing sensitive).'),
    ])));

    page.append(more(t('防护细节', 'Control details'), list([
      'Content-Security-Policy: default-src \'self\'; script-src \'self\'; style-src \'self\' https://files.dliu.com/dliu.com/ui/; img-src \'self\' data: blob: https://files.dliu.com/dliu.com/ and the attachments bucket; object-src \'none\'; base-uri \'none\'; frame-ancestors \'none\'; form-action \'self\'',
      'Strict-Transport-Security: max-age=31536000 · X-Content-Type-Options: nosniff · X-Frame-Options: DENY · Referrer-Policy: no-referrer',
      'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      t('会话 Cookie：__Host-plan_session，HMAC-SHA256，30 天，HttpOnly、Secure、SameSite=Lax；密钥由客户端密钥派生', 'Session cookie: __Host-plan_session, HMAC-SHA256, 30 days, HttpOnly, Secure, SameSite=Lax; key derived from the client secret'),
      t('登录：授权码 + PKCE（S256）、state、nonce，临时保存在 10 分钟的 __Host-plan_auth Cookie 中', 'Sign-in: authorisation code with PKCE (S256), state and nonce, held for 10 minutes in a __Host-plan_auth cookie'),
      t('写请求：Origin 必须是 https://plan.dliu.com，类型必须是 application/json，请求体不超过 64 KB', 'Writes: Origin must be https://plan.dliu.com, the type application/json and the body at most 64 KB'),
      t('托管 API：API Gateway JWT 授权器；默认阶段每秒 10 个、突发 20 个', 'Managed API: API Gateway JWT authoriser; default stage limited to 10 requests a second, bursts of 20'),
      t('附件：上传签名 15 分钟并锁定大小和类型；下载签名 5 分钟；只有图片、PDF、纯文本、音视频可在浏览器内打开', 'Attachments: upload URLs last 15 minutes and fix the size and type; download URLs last 5 minutes; only images, PDF, plain text, audio and video open in the browser'),
      t('Lambda：保留并发 20；IAM 只允许读写本表、本桶和 /travel-plan/ 参数；JSON 日志，只记录警告和错误，保留 3 个月', 'Lambda: reserved concurrency of 20; IAM only allows this table, this bucket and the /travel-plan/ parameters; JSON logs, warnings and errors only, kept 3 months'),
      t('PDF 导出：保留并发 5，只能读本表和 /travel-plan/ 参数，不能访问附件桶；只接受 GET；用户文字以纯文本排版，链接只保留 http(s)；PDF 不缓存', 'PDF export: reserved concurrency of 5; can only read this table and the /travel-plan/ parameters, not the files bucket; GET only; user text is laid out as plain text and only http(s) links are kept; PDFs are never cached'),
    ])));

    const refs = el('p', 'source');
    refs.append(
      t('参考：', 'References: '),
      link('https://owasp.org/www-project-top-ten/', 'OWASP Top 10', true), ' · ',
      link('https://learn.microsoft.com/azure/security/develop/threat-modeling-tool-threats', 'STRIDE', true), ' · ',
      link('https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html', t('XSS 防护', 'XSS prevention'), true), ' · ',
      link('https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html', t('文件上传', 'File upload'), true),
    );
    page.append(refs);
    return [tabs(t, '/docs/security'), page];
  }

  return { architecture, cost, security };
})();
