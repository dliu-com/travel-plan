'use strict';

// The /about and /security pages. All text is set through textContent (via PlanDiagram and el), never as HTML.
window.PlanInfo = (() => {
  const D = () => window.PlanDiagram;
  const REVIEWED = { zh: '2026 年 10 月 9 日', en: '9 October 2026' };

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
  function list(items, className = 'info-points') {
    const ul = el('ul', className);
    for (const item of items) ul.append(el('li', '', item));
    return ul;
  }
  function section(title, ...children) {
    const node = el('section', 'info-section');
    node.append(el('h2', '', title), ...children);
    return node;
  }
  function tabs(t, current) {
    const nav = el('nav', 'info-tabs');
    nav.setAttribute('aria-label', t('关于本站', 'About this site'));
    for (const [path, label] of [['/about', t('关于', 'About')], ['/security', t('安全', 'Security')]]) {
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

  // ---------------------------------------------------------------- About
  function about(t) {
    const { stats, tiers, flow, table, more, callout } = D();
    const page = el('article', 'info-page');
    page.append(
      el('h1', '', t('关于 DL 旅行计划', 'About DL Travel Plan')),
      tabs(t, '/about'),
      el('p', 'info-lead', t(
        'DL 旅行计划是一个私人行程规划网站：按天安排行程、标注确认状态、附上预订单和照片，再通过链接和同行的朋友一起编辑。网站完全运行在 AWS 无服务器服务上，空闲时不占用任何服务器。',
        'DL Travel Plan is a private trip planner: lay out each day, mark what is confirmed, attach bookings and photos, and share a link so travel companions can edit too. It runs entirely on AWS serverless services, so nothing is running when nobody is using it.',
      )),
      stats([
        ['0', t('空闲时运行的服务器', 'servers running when idle'), 'power'],
        ['≈ $0', t('每月费用（免费额度内）', 'a month, inside free tiers'), 'budget'],
        ['1', t('AWS 区域（爱尔兰）', 'AWS region (Ireland)'), 'globe'],
        ['0', t('后端运行时 npm 依赖', 'runtime npm dependencies'), 'stack'],
        ['144 bit', t('分享链接随机令牌', 'random share-link tokens'), 'key'],
        ['50 MB', t('单个附件上限，每个行程 200 个', 'per attachment, 200 per trip'), 'file'],
      ]),
    );

    page.append(section(t('技术架构', 'Technical architecture'),
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
          ] },
          { badge: t('数据', 'Data'), tone: 'private', label: t('私有数据', 'Private data'), link: t('IAM 最小权限', 'Least-privilege IAM'), nodes: [
            { icon: 'dynamodb', title: 'DynamoDB', text: t('行程与安排，按需计费，时间点恢复', 'Trips and events, on demand, point-in-time recovery') },
            { icon: 's3', title: t('S3 附件桶', 'S3 files bucket'), text: t('私有，仅限签名链接', 'Private, signed URLs only') },
            { icon: 'lock', title: 'SSM Parameter Store', text: t('Entra 客户端密钥（加密）', 'Entra client secret (encrypted)') },
          ] },
          { badge: t('监控', 'Ops'), label: t('日志与流量', 'Logs and traffic'), link: null, nodes: [
            { icon: 'chart', title: 'TrafficMonitor', text: t('CloudFront 访问日志 → raw/plan/', 'CloudFront access logs → raw/plan/') },
            { icon: 'eye', title: 'CloudWatch Logs', text: t('API 错误日志，保留 1 个月', 'API errors, kept for 1 month') },
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
          { icon: 'users', title: t('成员创建链接', 'A member makes a link'), text: t('144 位随机令牌', 'A 144-bit random token') },
          { icon: 'link', title: t('朋友打开', 'A friend opens it'), text: '/plan/20261000?token=…' },
          { icon: 'lambda', title: t('API 校验', 'API check'), text: t('令牌必须属于这个行程', 'The token must belong to this trip') },
          { icon: 'map', title: t('查看并编辑', 'View and edit'), text: t('仅限这一个行程', 'This one trip only'), tone: 'good' },
        ],
        note: t('“新链接”会让旧链接立即失效；“停止分享”会删除令牌。', 'New link makes the old one stop working at once; Stop sharing deletes the token.'),
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

    page.append(section(t('费用', 'Cost'),
      el('p', '', t(
        '没有常驻服务器，只按实际使用付费。对几个人用的行程网站，几乎所有用量都在 AWS 永久免费额度内。',
        'There are no always-on servers; it only costs anything when used. For a site a few people use, almost everything stays inside the AWS always-free tiers.',
      )),
      table([t('服务', 'Service'), t('用途', 'What it does'), t('免费额度 / 价格', 'Free tier / price'), t('本站每月', 'This site, monthly')], [
        ['CloudFront', t('HTTPS、缓存、改写', 'HTTPS, caching, rewrites'), t('1 TB 流量 + 1000 万请求；函数 200 万次', '1 TB + 10M requests; 2M function runs'), '$0'],
        ['Lambda', t('API', 'API'), t('100 万请求 + 40 万 GB-秒', '1M requests + 400k GB-seconds'), '$0'],
        ['DynamoDB', t('行程数据', 'Trip data'), t('按需；25 GB 存储免费', 'On demand; 25 GB storage free'), t('< $0.01', '< $0.01')],
        ['S3', t('网站文件与附件', 'Site files and attachments'), t('约 $0.023 / GB·月', 'about $0.023 per GB-month'), t('按附件量，通常 < $0.05', 'by attachment size, usually < $0.05')],
        [t('数据传出', 'Data out'), t('附件下载', 'Attachment downloads'), t('每月 100 GB 免费', '100 GB a month free'), '$0'],
        ['Route 53', t('plan.dliu.com DNS 记录', 'plan.dliu.com DNS record'), t('与 dliu.com 共用托管区', 'Shared dliu.com zone'), t('共用 $0.50', 'shared $0.50')],
        ['ACM · SSM · Entra ID', t('证书、密钥、登录', 'Certificate, secret, sign-in'), t('免费', 'Free'), '$0'],
        ['CloudWatch Logs', t('API 日志，1 个月', 'API logs, 1 month'), t('5 GB 免费', '5 GB free'), '$0'],
      ]),
      callout('budget', t(
        '预计合计：每月 $0–$0.10。最坏情况是一个行程放满 200 个 50 MB 的附件（10 GB），约每月 $0.23。API 最多同时运行 20 个实例，突发流量无法占满账户里其他网站共用的 Lambda 并发。',
        'Expected total: $0–$0.10 a month. The worst case, one trip full of 200 × 50 MB attachments (10 GB), is about $0.23 a month. The API can run at most 20 copies at once, so a flood can’t use up the Lambda concurrency shared with the other dliu.com sites.',
      )),
    ));

    page.append(section(t('安全', 'Security'),
      list([
        t('只有 dliu.com 组织成员能登录并查看所有行程；分享链接只能打开对应的一个行程。', 'Only dliu.com members can sign in and see every trip; a share link opens just its own trip.'),
        t('严格的内容安全策略（CSP）：只运行本站脚本，禁止内联脚本、插件和被嵌入。', 'A strict Content Security Policy: only our own scripts run; no inline scripts, plugins or framing.'),
        t('所有用户输入都按纯文本显示；链接只允许 http(s)。', 'Everything users type is shown as plain text; links must be http(s).'),
        t('写请求必须来自 plan.dliu.com 并使用 JSON，阻止跨站请求伪造。', 'Writes must come from plan.dliu.com and use JSON, which blocks cross-site request forgery.'),
        t(`${REVIEWED.zh}进行了威胁建模和线上渗透测试。`, `Threat-modelled and penetration-tested live on ${REVIEWED.en}.`),
      ]),
      readMore(t, [{ href: '/security', icon: 'shield', title: t('安全审查', 'Security review'), text: t('信任边界、渗透测试结果、威胁模型和已接受的风险', 'Trust boundaries, pen-test results, threat model and accepted risks') }]),
    ));

    page.append(more(t('技术细节', 'Technical details'), list([
      t('基础设施：AWS CDK v2（TypeScript），一个堆栈，区域 eu-west-1；证书在 us-east-1。', 'Infrastructure: AWS CDK v2 (TypeScript), one stack in eu-west-1; the certificate lives in us-east-1.'),
      t('前端：一个 HTML 文件、一个 CSS 文件和三个原生 JavaScript 文件，无构建步骤，无第三方脚本。', 'Front end: one HTML file, one CSS file and three plain JavaScript files. No build step and no third-party scripts.'),
      t('后端：Node.js 22 Lambda（512 MB，15 秒超时），只用 Node 自带模块和 Lambda 运行时自带的 AWS SDK。', 'Back end: a Node.js 22 Lambda (512 MB, 15-second timeout) using only Node built-ins and the AWS SDK that ships with the runtime.'),
      t('S3 签名链接由 API 自己用 SigV4 生成，不额外引入依赖。', 'S3 signed URLs are made by the API itself with SigV4, without extra dependencies.'),
      t('数据：DynamoDB 全局表，按需计费，开启时间点恢复和删除保护；分享令牌通过 GSI 查找。', 'Data: a DynamoDB global table, on demand, with point-in-time recovery and deletion protection; share tokens are looked up through a GSI.'),
      t('行程编号：/plan/YYYYMMNN，即创建年月加两位序号；用条件写入避免重复。', 'Trip addresses: /plan/YYYYMMNN, the year and month created plus a two-digit number; conditional writes prevent clashes.'),
      t('测试：Jest 覆盖 API、存储、验证、S3 签名和 CDK 堆栈；每次部署前自动运行。', 'Tests: Jest covers the API, storage, validation, S3 signing and the CDK stack, and runs before every deploy.'),
      t('流量：CloudFront 标准日志（含 Cookie）写入 TrafficMonitor 的 raw/plan/。', 'Traffic: CloudFront standard logs (with cookies) go to TrafficMonitor under raw/plan/.'),
    ])));
    return page;
  }

  // ---------------------------------------------------------------- Security
  function security(t) {
    const { tiers, table, callout, more } = D();
    const PASS = { text: t('✓ 通过', '✓ Pass'), tone: 'pass' };
    const FIXED = { text: t('✓ 已修复', '✓ Fixed'), tone: 'fixed' };
    const LOW = { text: t('低', 'Low'), tone: 'low' };
    const MEDIUM = { text: t('中', 'Medium'), tone: 'medium' };
    const page = el('article', 'info-page');
    page.append(
      el('h1', '', t('安全', 'Security')),
      tabs(t, '/security'),
      callout('shield', t(
        `${REVIEWED.zh}完成威胁建模，并对线上 plan.dliu.com 进行了渗透测试（使用一个临时测试行程，测试后已删除）。发现的问题已修复并重新测试。`,
        `Threat-modelled and penetration-tested against the live plan.dliu.com on ${REVIEWED.en}, using a throwaway trip that was deleted afterwards. The issues found were fixed and re-tested.`,
      )),
    );

    page.append(section(t('信任边界', 'Trust boundaries'),
      tiers({
        title: t('请求如何穿过各层', 'How a request crosses each layer'),
        rows: [
          { badge: t('不可信', 'Untrusted'), tone: 'untrusted', label: t('互联网', 'Internet'), nodes: [
            { icon: 'users', title: t('组织成员', 'Members'), text: t('登录后可编辑所有行程', 'Signed in; edit every trip') },
            { icon: 'link', title: t('持链接的访客', 'Link holders'), text: t('可编辑一个行程，但输入同样不可信', 'Edit one trip; their input is still untrusted') },
            { icon: 'bot', title: t('攻击者与爬虫', 'Attackers and bots'), text: t('可以构造任何请求', 'Can send any request') },
          ] },
          { badge: t('边缘', 'Edge'), tone: 'edge', label: 'CloudFront', link: t('仅 HTTPS', 'HTTPS only'), nodes: [
            { icon: 'cloudfront', title: t('传输', 'Transport'), text: t('HTTP 跳转 HTTPS，TLS 1.2+，HSTS', 'HTTP → HTTPS, TLS 1.2+, HSTS') },
            { icon: 'shield', title: t('响应头', 'Headers'), text: 'CSP · X-Frame-Options · nosniff · Permissions-Policy' },
            { icon: 'lock', title: 'OAC', text: t('S3 和 Lambda 只接受 CloudFront 签名的请求', 'S3 and Lambda only accept CloudFront-signed requests') },
          ] },
          { badge: 'API', tone: 'app', label: 'Lambda', link: t('签名请求', 'Signed request'), nodes: [
            { icon: 'key', title: t('访问控制', 'Access control'), text: t('会话 Cookie 或该行程的令牌', 'Session cookie, or this trip’s token') },
            { icon: 'shield', title: t('请求检查', 'Request checks'), text: t('Origin、JSON、64 KB 上限', 'Origin, JSON, 64 KB limit') },
            { icon: 'check', title: t('输入验证', 'Validation'), text: t('长度、日期、链接协议、文件名', 'Lengths, dates, link schemes, file names') },
          ] },
          { badge: t('私有', 'Private'), tone: 'private', label: t('数据', 'Data'), link: t('最小权限 IAM', 'Least-privilege IAM'), nodes: [
            { icon: 'dynamodb', title: 'DynamoDB', text: t('仅 API 可访问', 'API only') },
            { icon: 's3', title: t('附件桶', 'Files bucket'), text: t('私有，签名链接 5–15 分钟有效', 'Private; signed URLs last 5–15 minutes') },
            { icon: 'lock', title: 'SSM', text: t('客户端密钥，仅 API 可读', 'Client secret, readable by the API only') },
          ] },
        ],
      }),
      table([t('身份', 'Who'), t('能做什么', 'What they can do')], [
        [t('dliu.com 成员', 'dliu.com members'), t('查看、创建、编辑、删除所有行程；创建或停止分享链接', 'See, create, edit and delete every trip; make or stop share links')],
        [t('持分享链接者', 'Share-link holders'), t('查看和编辑该行程的内容、安排和附件；不能删除行程、管理分享或看到其他行程', 'See and edit that trip’s details, events and files; cannot delete the trip, manage sharing or see other trips')],
        [t('其他人', 'Everyone else'), t('只能看到登录页、关于页和本页', 'Only the sign-in, About and this page')],
      ]),
    ));

    page.append(section(t('渗透测试结果', 'Penetration test results'),
      el('p', '', t('全部针对线上网站，用 curl、浏览器和直接构造的 S3 请求完成。', 'All run against the live site with curl, a browser and hand-made S3 requests.')),
      table([t('测试', 'Test'), t('结果', 'Result'), t('状态', 'Status')], [
        [t('存储型 XSS：行程字段', 'Stored XSS: trip fields'), t('<script>、<img onerror>、<svg onload>、模板和 Markdown 载荷放入标题、目的地、说明；在浏览器中全部展开查看，均显示为纯文本，没有执行', '<script>, <img onerror>, <svg onload>, template and Markdown payloads in the title, destination and description were rendered with everything expanded. All showed as plain text and nothing ran'), PASS],
        [t('存储型 XSS：安排字段', 'Stored XSS: event fields'), t('标题、地点、备注、链接中的载荷均为纯文本；地图链接经过编码', 'Payloads in title, place, notes and links stayed text; map links are encoded'), PASS],
        [t('危险链接', 'Dangerous links'), t('javascript:（含大小写和前导空格）、data:、vbscript:、file:、// 链接均被拒绝（400）', 'javascript: (any case, leading spaces), data:, vbscript:, file: and // links are refused (400)'), PASS],
        [t('恶意文件名', 'Malicious file names'), t('含 HTML 的文件名显示为文本；CRLF 和引号无法注入响应头', 'File names containing HTML show as text; CRLF and quotes cannot inject headers'), PASS],
        [t('文件名换行与方向字符', 'Line breaks and direction marks in file names'), t('换行、制表符和 RLO 等方向控制字符曾被保存，可伪装扩展名（如 invoice‮txt.exe）；现已清除', 'Line breaks, tabs and RLO-style direction marks were stored and could disguise an extension; they are now stripped'), FIXED],
        [t('上传 HTML/SVG', 'Uploading HTML or SVG'), t('HTML、SVG、XHTML、UTF-7 文本一律作为 application/octet-stream 附件下载，且来自 S3 域名而非 plan.dliu.com', 'HTML, SVG, XHTML and UTF-7 text always download as application/octet-stream, from the S3 domain rather than plan.dliu.com'), PASS],
        [t('篡改签名上传', 'Tampering with signed uploads'), t('更大的文件、不同的类型、换一个对象名、用上传链接下载：S3 均返回 403', 'A larger body, another content type, another key, or a GET with the upload URL: S3 returns 403 for all'), PASS],
        [t('上传边界', 'Upload limits'), t('0 字节、60 MB、负数或字符串大小、未上传就确认、确认到其他行程均被拒绝', 'Zero bytes, 60 MB, negative or string sizes, confirming before uploading, or into another trip are all refused'), PASS],
        [t('未登录访问', 'Anonymous access'), t('行程列表和行程返回 401；伪造的会话 Cookie 返回 401', 'Trip list and trips return 401; a forged session cookie returns 401'), PASS],
        [t('令牌越权', 'Token scope'), t('错误令牌、少一位的令牌、用 A 行程令牌访问 B 行程均返回 403；令牌不能列出行程、删除行程、改分享或新建行程', 'A wrong token, a token one character short, or trip A’s token on trip B return 403; a token cannot list, delete, reshare or create trips'), PASS],
        [t('行程枚举', 'Trip enumeration'), t('不存在的行程与无权限的行程返回相同的 401/403，无法探测编号', 'Missing trips get the same 401/403 as forbidden ones, so ids cannot be probed'), PASS],
        [t('跨站请求伪造', 'Cross-site request forgery'), t('外站、缺失或 null 的 Origin 返回 403；text/plain 与表单编码返回 415', 'A foreign, missing or null Origin returns 403; text/plain and form encodings return 415'), PASS],
        ['CORS', t('API 不对其他来源返回 Access-Control-Allow-Origin', 'The API sends no Access-Control-Allow-Origin to other origins'), PASS],
        [t('开放重定向', 'Open redirect'), t('登录返回地址 //evil、/\\evil、https://evil、制表符技巧均回到 /', 'Return paths //evil, /\\evil, https://evil and tab tricks all go to /'), PASS],
        [t('登录回调', 'Sign-in callback'), t('错误的 state 返回 400；错误页对 HTML 转义', 'A wrong state returns 400; the error page escapes HTML'), PASS],
        [t('绕过 CloudFront', 'Bypassing CloudFront'), t('直接访问 Lambda 函数 URL、站点桶、附件桶列表和未签名对象均返回 403', 'Calling the Lambda URL, the site bucket, a files-bucket listing or an unsigned object directly returns 403'), PASS],
        [t('敏感文件', 'Hidden files'), t('/.git/config、/.env、/package.json、源码映射、/lambda/ 均返回 403', '/.git/config, /.env, /package.json, source maps and /lambda/ return 403'), PASS],
        [t('缓存泄露', 'Cache leaks'), t('API 响应 no-store 且不缓存：带令牌请求后，匿名请求仍是 401', 'API responses are no-store and uncached: after a token request, an anonymous one still gets 401'), PASS],
        [t('畸形输入', 'Malformed input'), t('坏 JSON、数组、70 KB 请求体、1000 字标题、对象类型字段、坏日期均被拒绝；__proto__、id、shareToken 被忽略', 'Bad JSON, arrays, a 70 KB body, a 1000-character title, object-typed fields and bad dates are refused; __proto__, id and shareToken are ignored'), PASS],
        [t('路径技巧', 'Path tricks'), t('编码的 ../、%00、%2e%2e 返回 400/403/404', 'Encoded ../, %00 and %2e%2e return 400/403/404'), PASS],
        [t('HTTP 方法', 'HTTP methods'), t('PATCH、TRACE、OPTIONS 返回 405；对静态文件 PUT/DELETE 返回 403', 'PATCH, TRACE and OPTIONS return 405; PUT/DELETE on static files return 403'), PASS],
        [t('传输安全', 'Transport'), t('HTTP 跳转 HTTPS；TLS 1.0/1.1 被拒绝；HSTS 一年', 'HTTP redirects to HTTPS; TLS 1.0 and 1.1 are refused; HSTS for a year'), PASS],
        [t('浏览器权限', 'Browser features'), t('原先没有 Permissions-Policy；现已禁用摄像头、麦克风、定位、支付和 USB', 'There was no Permissions-Policy; camera, microphone, location, payment and USB are now disabled'), FIXED],
        [t('流量耗尽', 'Exhausting capacity'), t('API 原先可以用尽账户里所有网站共用的 Lambda 并发；现限制为最多 20 个', 'The API could use up the Lambda concurrency shared by every site in the account; it is now capped at 20'), FIXED],
        [t('依赖与密钥', 'Dependencies and secrets'), t('npm audit（生产）0 个问题；代码中没有硬编码密钥', 'npm audit (production) finds nothing; no secrets in the code'), PASS],
      ], 'pentest'),
    ));

    page.append(section(t('威胁模型', 'Threat model'),
      table([t('场景', 'Scenario'), t('剩余风险', 'Residual risk'), t('控制措施', 'Controls')], [
        [t('有人在行程或安排里写入恶意脚本（XSS）', 'Someone puts a malicious script in a trip or event (XSS)'), LOW, t('所有内容用 textContent 渲染，从不拼接 HTML；CSP 只允许本站脚本，禁止内联；链接仅 http(s)', 'Everything is rendered with textContent, never as HTML; the CSP only allows our own scripts and no inline code; links must be http(s)')],
        [t('上传恶意 HTML/SVG 来窃取会话', 'Uploading HTML or SVG to steal sessions'), LOW, t('网页类文件强制下载；附件来自 S3 域名，接触不到 plan.dliu.com 的 Cookie', 'Web content is forced to download; files come from the S3 domain, which cannot reach plan.dliu.com cookies')],
        [t('上传病毒或伪装扩展名的文件', 'Uploading malware or files with disguised extensions'), MEDIUM, t('清除文件名中的方向控制字符；危险类型只能下载；但没有病毒扫描，打开前请确认来源', 'Direction marks are stripped from names; risky types only download; but there is no virus scan, so check before opening')],
        [t('分享链接泄露', 'A share link leaks'), MEDIUM, t('令牌只能用于一个行程，不能删除行程；随时可用“新链接”或“停止分享”作废', 'A token works for one trip and cannot delete it; New link or Stop sharing revokes it at once')],
        [t('暴力猜测令牌或行程编号', 'Guessing tokens or trip ids'), LOW, t('144 位随机令牌，实际上无法猜中；编号可猜，但没有令牌或登录只会得到相同的拒绝', '144-bit random tokens are infeasible to guess; ids are guessable, but without a token or sign-in every guess gets the same refusal')],
        [t('跨站请求伪造（CSRF）', 'Cross-site request forgery'), LOW, t('SameSite=Lax 会话 Cookie；写请求必须带 plan.dliu.com 的 Origin 和 JSON 类型', 'SameSite=Lax session cookie; writes need the plan.dliu.com Origin and a JSON body')],
        [t('点击劫持', 'Clickjacking'), LOW, 'X-Frame-Options: DENY · frame-ancestors \'none\''],
        [t('窃取或伪造会话', 'Stealing or forging a session'), LOW, t('HMAC-SHA256 签名，HttpOnly、Secure、__Host- 前缀；登录使用 PKCE、state、nonce 并校验 id_token', 'HMAC-SHA256 signature, HttpOnly, Secure, __Host- prefix; sign-in uses PKCE, state and nonce and verifies the id_token')],
        [t('非组织账号登录', 'Signing in from outside the organisation'), LOW, t('只信任 dliu.com 租户，且用户名必须以 @dliu.com 结尾', 'Only the dliu.com tenant is trusted, and the username must end in @dliu.com')],
        [t('绕过 CloudFront 直接访问后端', 'Going around CloudFront to the back end'), LOW, t('Lambda 函数 URL 需 IAM 签名，S3 桶阻止所有公开访问，只信任 CloudFront OAC', 'The Lambda URL needs IAM signing and the buckets block all public access; only CloudFront OAC is trusted')],
        [t('刷流量造成费用或拖垮其他网站', 'Floods that run up costs or starve other sites'), MEDIUM, t('并发上限 20；上传大小和数量有上限，未确认的上传 1 天后删除；没有 WAF 或限流', 'Concurrency capped at 20; upload size and count are limited and unconfirmed uploads expire after a day; no WAF or rate limit')],
        [t('访客添加钓鱼链接或删除安排', 'A guest adds phishing links or deletes events'), MEDIUM, t('仅限持链接者；记录最后修改人；DynamoDB 时间点恢复可回滚 35 天内的数据', 'Only link holders can; the last editor is recorded; DynamoDB point-in-time recovery can roll back 35 days')],
        [t('数据被误删', 'Data deleted by mistake'), LOW, t('表开启删除保护和时间点恢复；表和附件桶在堆栈删除时保留', 'The table has deletion protection and point-in-time recovery; the table and files bucket are retained if the stack is removed')],
        [t('客户端密钥泄露', 'The client secret leaks'), LOW, t('存放在 SSM 加密参数中，仅 API 角色可读；不在代码或日志里', 'Kept in an encrypted SSM parameter readable only by the API role; never in code or logs')],
      ]),
    ));

    page.append(section(t('已接受的风险', 'Accepted residual risks'), list([
      t('持分享链接的人可以编辑或删除安排、添加链接和上传文件。只把链接发给信任的人。', 'Anyone with a share link can edit or delete events, add links and upload files. Only send links to people you trust.'),
      t('令牌在网址中，会出现在浏览器历史和私有的 CloudFront/TrafficMonitor 访问日志里。', 'Tokens are in the URL, so they appear in browser history and in the private CloudFront and TrafficMonitor access logs.'),
      t('没有 WAF 或速率限制；并发上限能保护其他网站，但不能完全阻止刷流量带来的少量费用。', 'There is no WAF or rate limit; the concurrency cap protects the other sites but cannot stop a flood costing a little money.'),
      t('附件没有病毒扫描。伪装成图片或文本的 HTML 会以图片/文本类型从 S3 显示，浏览器不会把它当网页执行。', 'Attachments are not virus-scanned. HTML disguised as an image or text is served from S3 with that type, and browsers do not run it as a page.'),
      t('会话无法在服务端撤销：被移出组织的成员最多还能用 30 天。轮换 Entra 客户端密钥会让所有人立即退出。', 'Sessions cannot be revoked on the server: someone removed from the organisation keeps access for up to 30 days. Rotating the Entra client secret signs everyone out at once.'),
      t('退出登录是 GET 请求，其他网站可以让你退出（影响很小）。', 'Sign-out is a GET request, so another site could sign you out (low impact).'),
      t('HSTS 未包含子域名，以免影响 dliu.com 的其他网站。', 'HSTS does not include subdomains, so other dliu.com sites are not affected.'),
      t('访问不存在的静态文件时显示 S3 的 403 XML（无敏感信息）。', 'Missing static files show S3’s 403 XML page (nothing sensitive).'),
    ])));

    page.append(more(t('防护细节', 'Control details'), list([
      'Content-Security-Policy: default-src \'self\'; script-src \'self\'; style-src \'self\'; object-src \'none\'; base-uri \'none\'; frame-ancestors \'none\'; form-action \'self\'',
      'Strict-Transport-Security: max-age=31536000 · X-Content-Type-Options: nosniff · X-Frame-Options: DENY · Referrer-Policy: no-referrer',
      'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      t('会话 Cookie：__Host-plan_session，HMAC-SHA256，30 天，HttpOnly、Secure、SameSite=Lax；密钥由客户端密钥派生', 'Session cookie: __Host-plan_session, HMAC-SHA256, 30 days, HttpOnly, Secure, SameSite=Lax; key derived from the client secret'),
      t('登录：授权码 + PKCE（S256）、state、nonce，临时保存在 10 分钟的 __Host-plan_auth Cookie 中', 'Sign-in: authorisation code with PKCE (S256), state and nonce, held for 10 minutes in a __Host-plan_auth cookie'),
      t('写请求：Origin 必须是 https://plan.dliu.com，类型必须是 application/json，请求体不超过 64 KB', 'Writes: Origin must be https://plan.dliu.com, the type application/json and the body at most 64 KB'),
      t('附件：上传签名 15 分钟并锁定大小和类型；下载签名 5 分钟；只有图片、PDF、纯文本、音视频可在浏览器内打开', 'Attachments: upload URLs last 15 minutes and fix the size and type; download URLs last 5 minutes; only images, PDF, plain text, audio and video open in the browser'),
      t('Lambda：保留并发 20；IAM 只允许读写本表、本桶和 /travel-plan/ 参数', 'Lambda: reserved concurrency of 20; IAM only allows this table, this bucket and the /travel-plan/ parameters'),
    ])));

    const refs = el('p', 'info-links');
    refs.append(
      t('参考：', 'References: '),
      link('https://owasp.org/www-project-top-ten/', 'OWASP Top 10', true), ' · ',
      link('https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html', t('XSS 防护', 'XSS prevention'), true), ' · ',
      link('https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html', t('文件上传', 'File upload'), true), ' · ',
      link('https://owasp.org/www-community/Threat_Modeling', t('威胁建模', 'Threat modelling'), true),
    );
    page.append(refs);
    return page;
  }

  return { about, security };
})();
