// Cloudflare Worker - 简化版优选工具
// 仅保留优选域名、优选IP、GitHub、上报和节点生成功能
// 修复记录：已修正 VMess 协议下节点名称包含中文导致 Error 1101 的问题

// 默认配置
let customPreferredIPs = [];
let customPreferredDomains = [];
let epd = true;  // 启用优选域名
let epi = true;  // 启用优选IP
let egi = true;  // 启用GitHub优选
let ev = true;   // 启用VLESS协议
let et = false;  // 启用Trojan协议
let vm = false;  // 启用VMess协议
let scu = 'https://url.v1.mk/sub';  // 订阅转换地址
// ECH (Encrypted Client Hello)
let enableECH = false;
let customDNS = 'https://dns.joeyblog.eu.org/joeyblog';
let customECHDomain = 'cloudflare-ech.com';

// 默认优选域名列表
const directDomains = [
    { name: "cloudflare.182682.xyz", domain: "cloudflare.182682.xyz" },
    { domain: "freeyx.cloudflare88.eu.org" },
    { domain: "bestcf.top" },
    { domain: "cdn.2020111.xyz" },
    { domain: "cf.0sm.com" },
    { domain: "cf.090227.xyz" },
    { domain: "cf.zhetengsha.eu.org" },
    { domain: "cfip.1323123.xyz" },
    { domain: "cloudflare-ip.mofashi.ltd" },
    { domain: "cf.877771.xyz" },
    { domain: "xn--b6gac.eu.org" }
];

// 默认优选IP来源URL
const defaultIPURL = 'https://raw.githubusercontent.com/qwer-search/bestip/refs/heads/main/kejilandbestip.txt';

// UUID验证
function isValidUUID(str) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str);
}

// 从环境变量获取配置
function getConfigValue(key, defaultValue) {
    return defaultValue || '';
}

// 获取动态IP列表（支持IPv4/IPv6和运营商筛选）
async function fetchDynamicIPs(ipv4Enabled = true, ipv6Enabled = true, ispMobile = true, ispUnicom = true, ispTelecom = true) {
    const v4Url = "https://www.wetest.vip/page/cloudflare/address_v4.html";
    const v6Url = "https://www.wetest.vip/page/cloudflare/address_v6.html";
    let results = [];

    try {
        const fetchPromises = [];
        if (ipv4Enabled) {
            fetchPromises.push(fetchAndParseWetest(v4Url));
        } else {
            fetchPromises.push(Promise.resolve([]));
        }
        if (ipv6Enabled) {
            fetchPromises.push(fetchAndParseWetest(v6Url));
        } else {
            fetchPromises.push(Promise.resolve([]));
        }

        const [ipv4List, ipv6List] = await Promise.all(fetchPromises);
        results = [...ipv4List, ...ipv6List];
        
        // 按运营商筛选
        if (results.length > 0) {
            results = results.filter(item => {
                const isp = item.isp || '';
                if (isp.includes('移动') && !ispMobile) return false;
                if (isp.includes('联通') && !ispUnicom) return false;
                if (isp.includes('电信') && !ispTelecom) return false;
                return true;
            });
        }
        
        return results.length > 0 ? results : [];
    } catch (e) {
        return [];
    }
}

// 解析wetest页面
async function fetchAndParseWetest(url) {
    try {
        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!response.ok) return [];
        const html = await response.text();
        const results = [];
        const rowRegex = /<tr[\s\S]*?<\/tr>/g;
        const cellRegex = /<td data-label="线路名称">(.+?)<\/td>[\s\S]*?<td data-label="优选地址">([\d.:a-fA-F]+)<\/td>[\s\S]*?<td data-label="数据中心">(.+?)<\/td>/;

        let match;
        while ((match = rowRegex.exec(html)) !== null) {
            const rowHtml = match[0];
            const cellMatch = rowHtml.match(cellRegex);
            if (cellMatch && cellMatch[1] && cellMatch[2]) {
                const colo = cellMatch[3] ? cellMatch[3].trim().replace(/<.*?>/g, '') : '';
                results.push({
                    isp: cellMatch[1].trim().replace(/<.*?>/g, ''),
                    ip: cellMatch[2].trim(),
                    colo: colo
                });
            }
        }
        return results;
    } catch (error) {
        return [];
    }
}

// 整理成数组
async function 整理成数组(内容) {
    var 替换后的内容 = 内容.replace(/[	"'\r\n]+/g, ',').replace(/,+/g, ',');
    if (替换后的内容.charAt(0) == ',') 替换后的内容 = 替换后的内容.slice(1);
    if (替换后的内容.charAt(替换后的内容.length - 1) == ',') 替换后的内容 = 替换后的内容.slice(0, 替换后的内容.length - 1);
    const 地址数组 = 替换后的内容.split(',');
    return 地址数组;
}

// 请求优选API
async function 请求优选API(urls, 默认端口 = '443', 超时时间 = 3000) {
    if (!urls?.length) return [];
    const results = new Set();
    await Promise.allSettled(urls.map(async (url) => {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 超时时间);
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            let text = '';
            try {
                const buffer = await response.arrayBuffer();
                const contentType = (response.headers.get('content-type') || '').toLowerCase();
                const charset = contentType.match(/charset=([^\s;]+)/i)?.[1]?.toLowerCase() || '';

                // 根据 Content-Type 响应头判断编码优先级
                let decoders = ['utf-8', 'gb2312']; // 默认优先 UTF-8
                if (charset.includes('gb') || charset.includes('gbk') || charset.includes('gb2312')) {
                    decoders = ['gb2312', 'utf-8']; // 如果明确指定 GB 系编码，优先尝试 GB2312
                }

                // 尝试多种编码解码
                let decodeSuccess = false;
                for (const decoder of decoders) {
                    try {
                        const decoded = new TextDecoder(decoder).decode(buffer);
                        // 验证解码结果的有效性
                        if (decoded && decoded.length > 0 && !decoded.includes('\ufffd')) {
                            text = decoded;
                            decodeSuccess = true;
                            break;
                        } else if (decoded && decoded.length > 0) {
                            // 如果有替换字符 (U+FFFD)，说明编码不匹配，继续尝试下一个编码
                            continue;
                        }
                    } catch (e) {
                        // 该编码解码失败，尝试下一个
                        continue;
                    }
                }

                // 如果所有编码都失败或无效，尝试 response.text()
                if (!decodeSuccess) {
                    text = await response.text();
                }

                // 如果返回的是空或无效数据，返回
                if (!text || text.trim().length === 0) {
                    return;
                }
            } catch (e) {
                console.error('Failed to decode response:', e);
                return;
            }
            const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l);
            const isCSV = lines.length > 1 && lines[0].includes(',');
            const IPV6_PATTERN = /^[^\[\]]*:[^\[\]]*:[^\[\]]/;
            if (!isCSV) {
                lines.forEach(line => {
                    const hashIndex = line.indexOf('#');
                    const [hostPart, remark] = hashIndex > -1 ? [line.substring(0, hashIndex), line.substring(hashIndex)] : [line, ''];
                    let hasPort = false;
                    if (hostPart.startsWith('[')) {
                        hasPort = /\]:(\d+)$/.test(hostPart);
                    } else {
                        const colonIndex = hostPart.lastIndexOf(':');
                        hasPort = colonIndex > -1 && /^\d+$/.test(hostPart.substring(colonIndex + 1));
                    }
                    const port = new URL(url).searchParams.get('port') || 默认端口;
                    results.add(hasPort ? line : `${hostPart}:${port}${remark}`);
                });
            } else {
                const headers = lines[0].split(',').map(h => h.trim());
                const dataLines = lines.slice(1);
                if (headers.includes('IP地址') && headers.includes('端口') && headers.includes('数据中心')) {
                    const ipIdx = headers.indexOf('IP地址'), portIdx = headers.indexOf('端口');
                    const remarkIdx = headers.indexOf('国家') > -1 ? headers.indexOf('国家') :
                        headers.indexOf('城市') > -1 ? headers.indexOf('城市') : headers.indexOf('数据中心');
                    const tlsIdx = headers.indexOf('TLS');
                    dataLines.forEach(line => {
                        const cols = line.split(',').map(c => c.trim());
                        if (tlsIdx !== -1 && cols[tlsIdx]?.toLowerCase() !== 'true') return;
                        const wrappedIP = IPV6_PATTERN.test(cols[ipIdx]) ? `[${cols[ipIdx]}]` : cols[ipIdx];
                        results.add(`${wrappedIP}:${cols[portIdx]}#${cols[remarkIdx]}`);
                    });
                } else if (headers.some(h => h.includes('IP')) && headers.some(h => h.includes('延迟')) && headers.some(h => h.includes('下载速度'))) {
                    const ipIdx = headers.findIndex(h => h.includes('IP'));
                    const delayIdx = headers.findIndex(h => h.includes('延迟'));
                    const speedIdx = headers.findIndex(h => h.includes('下载速度'));
                    const port = new URL(url).searchParams.get('port') || 默认端口;
                    dataLines.forEach(line => {
                        const cols = line.split(',').map(c => c.trim());
                        const wrappedIP = IPV6_PATTERN.test(cols[ipIdx]) ? `[${cols[ipIdx]}]` : cols[ipIdx];
                        results.add(`${wrappedIP}:${port}#CF优选 ${cols[delayIdx]}ms ${cols[speedIdx]}MB/s`);
                    });
                }
            }
        } catch (e) { }
    }));
    return Array.from(results);
}

// 从GitHub获取优选IP（保留原有功能，同时支持优选API）
async function fetchAndParseNewIPs(piu) {
    const url = piu || defaultIPURL;
    try {
        const response = await fetch(url);
        if (!response.ok) return [];
        const text = await response.text();
        const results = [];
        const lines = text.trim().replace(/\r/g, "").split('\n');
        const regex = /^([^:]+):(\d+)#(.*)$/;

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;
            const match = trimmedLine.match(regex);
            if (match) {
                results.push({
                    ip: match[1],
                    port: parseInt(match[2], 10),
                    name: match[3].trim() || match[1]
                });
            }
        }
        return results;
    } catch (error) {
        return [];
    }
}

// 生成VLESS链接
function generateLinksFromSource(list, user, workerDomain, disableNonTLS = false, customPath = '/', echConfig = null) {
    const CF_HTTP_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095];
    const CF_HTTPS_PORTS = [443, 2053, 2083, 2087, 2096, 8443];
    const defaultHttpsPorts = [443];
    const defaultHttpPorts = disableNonTLS ? [] : [80];
    const links = [];
    const wsPath = customPath || '/';
    const proto = 'vless';

    list.forEach(item => {
        let nodeNameBase = item.isp ? item.isp.replace(/\s/g, '_') : (item.name || item.domain || item.ip);
        if (item.colo && item.colo.trim()) {
            nodeNameBase = `${nodeNameBase}-${item.colo.trim()}`;
        }
        const safeIP = item.ip.includes(':') ? `[${item.ip}]` : item.ip;
        
        let portsToGenerate = [];
        
        if (item.port) {
            const port = item.port;
            if (CF_HTTPS_PORTS.includes(port)) {
                portsToGenerate.push({ port: port, tls: true });
            } else if (CF_HTTP_PORTS.includes(port)) {
                portsToGenerate.push({ port: port, tls: false });
            } else {
                portsToGenerate.push({ port: port, tls: true });
            }
        } else {
            defaultHttpsPorts.forEach(port => {
                portsToGenerate.push({ port: port, tls: true });
            });
            defaultHttpPorts.forEach(port => {
                portsToGenerate.push({ port: port, tls: false });
            });
        }

        portsToGenerate.forEach(({ port, tls }) => {
            if (tls) {
                const wsNodeName = `${nodeNameBase}-${port}-WS-TLS`;
                const wsParams = new URLSearchParams({ 
                    encryption: 'none', 
                    security: 'tls', 
                    sni: workerDomain, 
                    fp: 'chrome', 
                    type: 'ws', 
                    host: workerDomain, 
                    path: wsPath
                });
                if (echConfig) {
                    wsParams.set('alpn', 'h3,h2,http/1.1');
                    wsParams.set('ech', echConfig);
                }
                links.push(`${proto}://${user}@${safeIP}:${port}?${wsParams.toString()}#${encodeURIComponent(wsNodeName)}`);
            } else {
                const wsNodeName = `${nodeNameBase}-${port}-WS`;
                const wsParams = new URLSearchParams({
                    encryption: 'none',
                    security: 'none',
                    type: 'ws',
                    host: workerDomain,
                    path: wsPath
                });
                links.push(`${proto}://${user}@${safeIP}:${port}?${wsParams.toString()}#${encodeURIComponent(wsNodeName)}`);
            }
        });
    });
    return links;
}

// 生成Trojan链接
async function generateTrojanLinksFromSource(list, user, workerDomain, disableNonTLS = false, customPath = '/', echConfig = null) {
    const CF_HTTP_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095];
    const CF_HTTPS_PORTS = [443, 2053, 2083, 2087, 2096, 8443];
    const defaultHttpsPorts = [443];
    const defaultHttpPorts = disableNonTLS ? [] : [80];
    const links = [];
    const wsPath = customPath || '/';
    const password = user;  // Trojan使用UUID作为密码

    list.forEach(item => {
        let nodeNameBase = item.isp ? item.isp.replace(/\s/g, '_') : (item.name || item.domain || item.ip);
        if (item.colo && item.colo.trim()) {
            nodeNameBase = `${nodeNameBase}-${item.colo.trim()}`;
        }
        const safeIP = item.ip.includes(':') ? `[${item.ip}]` : item.ip;
        
        let portsToGenerate = [];
        
        if (item.port) {
            const port = item.port;
            if (CF_HTTPS_PORTS.includes(port)) {
                portsToGenerate.push({ port: port, tls: true });
            } else if (CF_HTTP_PORTS.includes(port)) {
                if (!disableNonTLS) {
                    portsToGenerate.push({ port: port, tls: false });
                }
            } else {
                portsToGenerate.push({ port: port, tls: true });
            }
        } else {
            defaultHttpsPorts.forEach(port => {
                portsToGenerate.push({ port: port, tls: true });
            });
            defaultHttpPorts.forEach(port => {
                portsToGenerate.push({ port: port, tls: false });
            });
        }

        portsToGenerate.forEach(({ port, tls }) => {
            if (tls) {
                const wsNodeName = `${nodeNameBase}-${port}-Trojan-WS-TLS`;
                const wsParams = new URLSearchParams({ 
                    security: 'tls', 
                    sni: workerDomain, 
                    fp: 'chrome', 
                    type: 'ws', 
                    host: workerDomain, 
                    path: wsPath
                });
                if (echConfig) {
                    wsParams.set('alpn', 'h3,h2,http/1.1');
                    wsParams.set('ech', echConfig);
                }
                links.push(`trojan://${password}@${safeIP}:${port}?${wsParams.toString()}#${encodeURIComponent(wsNodeName)}`);
            } else {
                const wsNodeName = `${nodeNameBase}-${port}-Trojan-WS`;
                const wsParams = new URLSearchParams({
                    security: 'none',
                    type: 'ws',
                    host: workerDomain,
                    path: wsPath
                });
                links.push(`trojan://${password}@${safeIP}:${port}?${wsParams.toString()}#${encodeURIComponent(wsNodeName)}`);
            }
        });
    });
    return links;
}

// 生成VMess链接 (已修复中文名导致1101报错的问题)
function generateVMessLinksFromSource(list, user, workerDomain, disableNonTLS = false, customPath = '/', echConfig = null) {
    const CF_HTTP_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095];
    const CF_HTTPS_PORTS = [443, 2053, 2083, 2087, 2096, 8443];
    const defaultHttpsPorts = [443];
    const defaultHttpPorts = disableNonTLS ? [] : [80];
    const links = [];
    const wsPath = customPath || '/';

    list.forEach(item => {
        let nodeNameBase = item.isp ? item.isp.replace(/\s/g, '_') : (item.name || item.domain || item.ip);
        if (item.colo && item.colo.trim()) {
            nodeNameBase = `${nodeNameBase}-${item.colo.trim()}`;
        }
        const safeIP = item.ip.includes(':') ? `[${item.ip}]` : item.ip;
        
        let portsToGenerate = [];
        
        if (item.port) {
            const port = item.port;
            if (CF_HTTPS_PORTS.includes(port)) {
                portsToGenerate.push({ port: port, tls: true });
            } else if (CF_HTTP_PORTS.includes(port)) {
                if (!disableNonTLS) {
                    portsToGenerate.push({ port: port, tls: false });
                }
            } else {
                portsToGenerate.push({ port: port, tls: true });
            }
        } else {
            defaultHttpsPorts.forEach(port => {
                portsToGenerate.push({ port: port, tls: true });
            });
            defaultHttpPorts.forEach(port => {
                portsToGenerate.push({ port: port, tls: false });
            });
        }

        portsToGenerate.forEach(({ port, tls }) => {
            const vmessConfig = {
                v: "2",
                ps: tls ? `${nodeNameBase}-${port}-VMess-WS-TLS` : `${nodeNameBase}-${port}-VMess-WS`,
                add: safeIP,
                port: port.toString(),
                id: user,
                aid: "0",
                scy: "auto",
                net: "ws",
                type: "none",
                host: workerDomain,
                path: wsPath,
                tls: tls ? "tls" : "none"
            };
            if (tls) {
                vmessConfig.sni = workerDomain;
                vmessConfig.fp = "chrome";
            }
            
            // 核心修复：处理中文编码，防止 btoa 报错
            const jsonStr = JSON.stringify(vmessConfig);
            const vmessBase64 = btoa(encodeURIComponent(jsonStr).replace(/%([0-9A-F]{2})/g,
                function toSolidBytes(match, p1) {
                    return String.fromCharCode('0x' + p1);
            }));
            
            links.push(`vmess://${vmessBase64}`);
        });
    });
    return links;
}

// 从GitHub IP生成链接（VLESS）
function generateLinksFromNewIPs(list, user, workerDomain, customPath = '/', echConfig = null) {
    const CF_HTTP_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095];
    const CF_HTTPS_PORTS = [443, 2053, 2083, 2087, 2096, 8443];
    const links = [];
    const wsPath = customPath || '/';
    const proto = 'vless';
    const echSuffix = echConfig ? `&alpn=h3%2Ch2%2Chttp%2F1.1&ech=${encodeURIComponent(echConfig)}` : '';
    
    list.forEach(item => {
        const nodeName = item.name.replace(/\s/g, '_');
        const port = item.port;
        
        if (CF_HTTPS_PORTS.includes(port)) {
            const wsNodeName = `${nodeName}-${port}-WS-TLS`;
            const link = `${proto}://${user}@${item.ip}:${port}?encryption=none&security=tls&sni=${workerDomain}&fp=chrome&type=ws&host=${workerDomain}&path=${wsPath}${echSuffix}#${encodeURIComponent(wsNodeName)}`;
            links.push(link);
        } else if (CF_HTTP_PORTS.includes(port)) {
            const wsNodeName = `${nodeName}-${port}-WS`;
            const link = `${proto}://${user}@${item.ip}:${port}?encryption=none&security=none&type=ws&host=${workerDomain}&path=${wsPath}#${encodeURIComponent(wsNodeName)}`;
            links.push(link);
        } else {
            const wsNodeName = `${nodeName}-${port}-WS-TLS`;
            const link = `${proto}://${user}@${item.ip}:${port}?encryption=none&security=tls&sni=${workerDomain}&fp=chrome&type=ws&host=${workerDomain}&path=${wsPath}${echSuffix}#${encodeURIComponent(wsNodeName)}`;
            links.push(link);
        }
    });
    return links;
}

// 生成订阅内容
async function handleSubscriptionRequest(request, user, customDomain, piu, ipv4Enabled, ipv6Enabled, ispMobile, ispUnicom, ispTelecom, evEnabled, etEnabled, vmEnabled, disableNonTLS, customPath, echConfig = null) {
    const url = new URL(request.url);
    const finalLinks = [];
    const workerDomain = url.hostname;  // workerDomain始终是请求的hostname
    const nodeDomain = customDomain || url.hostname;  // 用户输入的域名用于生成节点时的host/sni
    const target = url.searchParams.get('target') || 'base64';
    const wsPath = customPath || '/';

    async function addNodesFromList(list) {
        // 确保至少有一个协议被启用
        const hasProtocol = evEnabled || etEnabled || vmEnabled;
        const useVL = hasProtocol ? evEnabled : true;  // 如果没有选择任何协议，默认使用VLESS
        
        if (useVL) {
            finalLinks.push(...generateLinksFromSource(list, user, nodeDomain, disableNonTLS, wsPath, echConfig));
        }
        if (etEnabled) {
            finalLinks.push(...await generateTrojanLinksFromSource(list, user, nodeDomain, disableNonTLS, wsPath, echConfig));
        }
        if (vmEnabled) {
            finalLinks.push(...generateVMessLinksFromSource(list, user, nodeDomain, disableNonTLS, wsPath, echConfig));
        }
    }

    // 原生地址
    const nativeList = [{ ip: workerDomain, isp: '原生地址' }];
    await addNodesFromList(nativeList);

    // 优选域名
    if (epd) {
        const domainList = directDomains.map(d => ({ ip: d.domain, isp: d.name || d.domain }));
        await addNodesFromList(domainList);
    }

    // 优选IP
    if (epi) {
        try {
            const dynamicIPList = await fetchDynamicIPs(ipv4Enabled, ipv6Enabled, ispMobile, ispUnicom, ispTelecom);
            if (dynamicIPList.length > 0) {
                await addNodesFromList(dynamicIPList);
            }
        } catch (error) {
            console.error('获取动态IP失败:', error);
        }
    }

    // GitHub优选 / 优选API
    if (egi) {
        try {
            // 检查是否是优选API URL（以https://开头）
            if (piu && piu.toLowerCase().startsWith('https://')) {
                // 从优选API获取IP列表
                const 优选API的IP = await 请求优选API([piu]);
                if (优选API的IP && 优选API的IP.length > 0) {
                    // 解析IP字符串格式：IP:端口#备注
                    const IP列表 = 优选API的IP.map(原始地址 => {
                        // 统一正则: 匹配 域名/IPv4/IPv6地址 + 可选端口 + 可选备注
                        const regex = /^(\[[\da-fA-F:]+\]|[\d.]+|[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*)(?::(\d+))?(?:#(.+))?$/;
                        const match = 原始地址.match(regex);

                        if (match) {
                            const 节点地址 = match[1].replace(/[\[\]]/g, ''); // 移除IPv6的方括号
                            const 节点端口 = match[2] || 443;
                            const 节点备注 = match[3] || 节点地址;
                            return {
                                ip: 节点地址,
                                port: parseInt(节点端口),
                                name: 节点备注
                            };
                        }
                        return null;
                    }).filter(item => item !== null);
                    
                    if (IP列表.length > 0) {
                        const hasProtocol = evEnabled || etEnabled || vmEnabled;
                        const useVL = hasProtocol ? evEnabled : true;
                        
                        if (useVL) {
                            finalLinks.push(...generateLinksFromNewIPs(IP列表, user, nodeDomain, wsPath, echConfig));
                        }
                    }
                }
            } else if (piu && piu.includes('\n')) {
                // 支持多行文本，包含混合格式（优选API URL + IP列表）
                const 完整优选列表 = await 整理成数组(piu);
                const 优选API = [], 优选IP = [], 其他节点 = [];
                
                for (const 元素 of 完整优选列表) {
                    if (元素.toLowerCase().startsWith('https://')) {
                        优选API.push(元素);
                    } else if (元素.toLowerCase().includes('://')) {
                        其他节点.push(元素);
                    } else {
                        优选IP.push(元素);
                    }
                }
                
                // 从优选API获取IP
                if (优选API.length > 0) {
                    const 优选API的IP = await 请求优选API(优选API);
                    优选IP.push(...优选API的IP);
                }
                
                // 解析所有IP并生成节点
                if (优选IP.length > 0) {
                    const IP列表 = 优选IP.map(原始地址 => {
                        const regex = /^(\[[\da-fA-F:]+\]|[\d.]+|[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*)(?::(\d+))?(?:#(.+))?$/;
                        const match = 原始地址.match(regex);

                        if (match) {
                            const 节点地址 = match[1].replace(/[\[\]]/g, '');
                            const 节点端口 = match[2] || 443;
                            const 节点备注 = match[3] || 节点地址;
                            return {
                                ip: 节点地址,
                                port: parseInt(节点端口),
                                name: 节点备注
                            };
                        }
                        return null;
                    }).filter(item => item !== null);
                    
                    if (IP列表.length > 0) {
                        const hasProtocol = evEnabled || etEnabled || vmEnabled;
                        const useVL = hasProtocol ? evEnabled : true;
                        
                        if (useVL) {
                            finalLinks.push(...generateLinksFromNewIPs(IP列表, user, nodeDomain, wsPath, echConfig));
                        }
                    }
                }
            } else {
                // 原有的GitHub优选逻辑（单URL）
                const newIPList = await fetchAndParseNewIPs(piu);
                if (newIPList.length > 0) {
                    const hasProtocol = evEnabled || etEnabled || vmEnabled;
                    const useVL = hasProtocol ? evEnabled : true;
                    
                    if (useVL) {
                        finalLinks.push(...generateLinksFromNewIPs(newIPList, user, nodeDomain, wsPath, echConfig));
                    }
                }
            }
        } catch (error) {
            console.error('获取优选IP失败:', error);
        }
    }

    if (finalLinks.length === 0) {
        const errorRemark = "所有节点获取失败";
        const errorLink = `vless://00000000-0000-0000-0000-000000000000@127.0.0.1:80?encryption=none&security=none&type=ws&host=error.com&path=%2F#${encodeURIComponent(errorRemark)}`;
        finalLinks.push(errorLink);
    }

    let subscriptionContent;
    let contentType = 'text/plain; charset=utf-8';
    
    switch (target.toLowerCase()) {
        case 'clash':
        case 'clashr':
            subscriptionContent = generateClashConfig(finalLinks);
            contentType = 'text/yaml; charset=utf-8';
            break;
        case 'surge':
        case 'surge2':
        case 'surge3':
        case 'surge4':
            subscriptionContent = generateSurgeConfig(finalLinks);
            break;
        case 'quantumult':
        case 'quanx':
            subscriptionContent = generateQuantumultConfig(finalLinks);
            break;
        default:
            subscriptionContent = btoa(finalLinks.join('\n'));
    }
    
    return new Response(subscriptionContent, {
        headers: { 
            'Content-Type': contentType,
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
    });
}

// 生成Clash配置（简化版，返回YAML格式）
function generateClashConfig(links) {
    let yaml = 'port: 7890\n';
    yaml += 'socks-port: 7891\n';
    yaml += 'allow-lan: false\n';
    yaml += 'mode: rule\n';
    yaml += 'log-level: info\n\n';
    yaml += 'proxies:\n';
    
    const proxyNames = [];
    links.forEach((link, index) => {
        const name = decodeURIComponent(link.split('#')[1] || `节点${index + 1}`);
        proxyNames.push(name);
        const server = link.match(/@([^:]+):(\d+)/)?.[1] || '';
        const port = link.match(/@[^:]+:(\d+)/)?.[1] || '443';
        const uuid = link.match(/vless:\/\/([^@]+)@/)?.[1] || '';
        const tls = link.includes('security=tls');
        const path = link.match(/path=([^&#]+)/)?.[1] || '/';
        const host = link.match(/host=([^&#]+)/)?.[1] || '';
        const sni = link.match(/sni=([^&#]+)/)?.[1] || '';
        const echParam = link.match(/[?&]ech=([^&#]+)/)?.[1];
        const echDomain = echParam ? decodeURIComponent(echParam).split('+')[0] : '';
        
        yaml += `  - name: ${name}\n`;
        yaml += `    type: vless\n`;
        yaml += `    server: ${server}\n`;
        yaml += `    port: ${port}\n`;
        yaml += `    uuid: ${uuid}\n`;
        yaml += `    tls: ${tls}\n`;
        yaml += `    network: ws\n`;
        yaml += `    ws-opts:\n`;
        yaml += `      path: ${path}\n`;
        yaml += `      headers:\n`;
        yaml += `        Host: ${host}\n`;
        if (sni) {
            yaml += `    servername: ${sni}\n`;
        }
        if (echDomain) {
            yaml += `    ech-opts:\n`;
            yaml += `      enable: true\n`;
            yaml += `      query-server-name: ${echDomain}\n`;
        }
    });
    
    yaml += '\nproxy-groups:\n';
    yaml += '  - name: PROXY\n';
    yaml += '    type: select\n';
    yaml += `    proxies: [${proxyNames.map(n => `'${n}'`).join(', ')}]\n`;
    yaml += '\nrules:\n';
    yaml += '  - DOMAIN-SUFFIX,local,DIRECT\n';
    yaml += '  - IP-CIDR,127.0.0.0/8,DIRECT\n';
    yaml += '  - GEOIP,CN,DIRECT\n';
    yaml += '  - MATCH,PROXY\n';
    
    return yaml;
}

// 生成Surge配置
function generateSurgeConfig(links) {
    let config = '[Proxy]\n';
    links.forEach(link => {
        const name = decodeURIComponent(link.split('#')[1] || '节点');
        config += `${name} = vless, ${link.match(/@([^:]+):(\d+)/)?.[1] || ''}, ${link.match(/@[^:]+:(\d+)/)?.[1] || '443'}, username=${link.match(/vless:\/\/([^@]+)@/)?.[1] || ''}, tls=${link.includes('security=tls')}, ws=true, ws-path=${link.match(/path=([^&#]+)/)?.[1] || '/'}, ws-headers=Host:${link.match(/host=([^&#]+)/)?.[1] || ''}\n`;
    });
    config += '\n[Proxy Group]\nPROXY = select, ' + links.map((_, i) => decodeURIComponent(links[i].split('#')[1] || `节点${i + 1}`)).join(', ') + '\n';
    return config;
}

// 生成Quantumult配置
function generateQuantumultConfig(links) {
    return btoa(links.join('\n'));
}

// 生成iOS 26风格的主页
function generateHomePage(scuValue) {
    const scu = scuValue || 'https://url.v1.mk/sub';
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <title>服务器优选工具</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif; background: linear-gradient(180deg, #f5f5f7 0%, #ffffff 50%, #fafafa 100%); color: #1d1d1f; min-height: 100vh; padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); overflow-x: hidden; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { text-align: center; padding: 48px 20px 32px; }
        .header h1 { font-size: 40px; font-weight: 700; letter-spacing: -0.3px; color: #1d1d1f; margin-bottom: 8px; line-height: 1.1; }
        .header p { font-size: 17px; color: #86868b; font-weight: 400; line-height: 1.5; }
        .card { background: rgba(255, 255, 255, 0.75); backdrop-filter: blur(30px) saturate(200%); -webkit-backdrop-filter: blur(30px) saturate(200%); border-radius: 24px; padding: 28px; margin-bottom: 20px; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.05); border: 0.5px solid rgba(0, 0, 0, 0.06); will-change: transform; }
        .form-group { margin-bottom: 24px; }
        .form-group:last-child { margin-bottom: 0; }
        .form-group label { display: block; font-size: 13px; font-weight: 600; color: #86868b; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
        .form-group input, .form-group textarea { width: 100%; padding: 14px 16px; font-size: 17px; font-weight: 400; color: #1d1d1f; background: rgba(142, 142, 147, 0.12); border: 2px solid transparent; border-radius: 12px; outline: none; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); -webkit-appearance: none; }
        .form-group input:focus, .form-group textarea:focus { background: rgba(142, 142, 147, 0.16); border-color: #007AFF; transform: scale(1.005); }
        .form-group input::placeholder, .form-group textarea::placeholder { color: #86868b; }
        .list-item { display: flex; align-items: center; justify-content: space-between; padding: 16px 0; min-height: 52px; cursor: pointer; border-bottom: 0.5px solid rgba(0, 0, 0, 0.08); }
        .list-item:last-child { border-bottom: none; }
        .list-item-label { font-size: 17px; font-weight: 400; color: #1d1d1f; flex: 1; }
        .switch { position: relative; display: inline-block; width: 51px; height: 31px; }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: rgba(120, 120, 128, 0.16); transition: .2s cubic-bezier(0.4, 0, 0.2, 1); border-radius: 31px; }
        .slider:before { position: absolute; content: ""; height: 27px; width: 27px; left: 2px; bottom: 2px; background-color: white; transition: .2s cubic-bezier(0.4, 0, 0.2, 1); border-radius: 50%; box-shadow: 0 3px 8px rgba(0,0,0,0.15), 0 1px 1px rgba(0,0,0,0.1); }
        input:checked + .slider { background-color: #34C759; }
        input:checked + .slider:before { transform: translateX(20px); }
        .btn-group { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px; }
        button { background: #007AFF; color: white; border: none; padding: 14px 20px; font-size: 17px; font-weight: 600; border-radius: 14px; cursor: pointer; transition: all 0.2s cubic-bezier(0.4, 0, 0.1, 1); display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 12px rgba(0,122,255,0.2); }
        button:active { transform: scale(0.96); background: #0066CC; opacity: 0.9; }
        .btn-secondary { background: rgba(142, 142, 147, 0.15); color: #007AFF; box-shadow: none; }
        .btn-secondary:active { background: rgba(142, 142, 147, 0.25); color: #0066CC; }
        #clientSubscriptionUrl { margin-top: 20px; padding: 16px; background: rgba(142, 142, 147, 0.1); border-radius: 12px; font-family: monospace; font-size: 13px; word-break: break-all; border: 0.5px solid rgba(0,0,0,0.05); color: #1d1d1f; display: none; max-height: 120px; overflow-y: auto; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>优选生成器</h1>
            <p>服务器矩阵聚合管理系统</p>
        </div>

        <div class="card">
            <div class="form-group">
                <label>服务器矩阵列表 (多机聚合)</label>
                <div id="serverContainer">
                    <div class="server-row" style="display: flex; gap: 6px; margin-bottom: 12px; align-items: center;">
                        <input type="text" class="server-input s-domain" style="flex: 1; min-width: 0; padding: 10px; border-radius: 8px; border: 1px solid rgba(142,142,147,0.3); background: rgba(142,142,147,0.12); color: inherit;" placeholder="域名/主机名">
                        <input type="text" class="server-input s-uuid" style="flex: 1; min-width: 0; padding: 10px; border-radius: 8px; border: 1px solid rgba(142,142,147,0.3); background: rgba(142,142,147,0.12); color: inherit;" placeholder="UUID/密码">
                        <input type="text" class="server-input s-prefix" style="width: 80px; padding: 10px; border-radius: 8px; border: 1px solid rgba(142,142,147,0.3); background: rgba(142,142,147,0.12); color: inherit;" placeholder="前缀" value="Node">
                        <button type="button" onclick="addServerRow()" style="width: 36px; height: 36px; background: #34C759; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; flex-shrink: 0; box-shadow: none; padding: 0;">+</button>
                    </div>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="form-group">
                <label>专属自定义选项</label>
                <div class="list-item">
                    <div class="list-item-label">启用 VLESS 协议</div>
                    <label class="switch"><input type="checkbox" id="switchVL" checked onchange="toggleSwitch('switchVL')"><span class="slider"></span></label>
                </div>
                <div class="list-item">
                    <div class="list-item-label">启用 Trojan 协议</div>
                    <label class="switch"><input type="checkbox" id="switchTJ" onchange="toggleSwitch('switchTJ')"><span class="slider"></span></label>
                </div>
                <div class="list-item">
                    <div class="list-item-label">启用 VMess 协议</div>
                    <label class="switch"><input type="checkbox" id="switchVM" onchange="toggleSwitch('switchVM')"><span class="slider"></span></label>
                </div>
                <div class="list-item">
                    <div class="list-item-label">仅保留 TLS 节点</div>
                    <label class="switch"><input type="checkbox" id="switchTLS" onchange="toggleSwitch('switchTLS')"><span class="slider"></span></label>
                </div>
            </div>
            <div class="form-group" style="margin-top: 16px;">
                <label>自定义连接路径</label>
                <input type="text" id="customPath" placeholder="/" value="/">
            </div>
            <div class="form-group" style="margin-top: 16px;">
                <label>GitHub 优选或外部 API URL</label>
                <input type="text" id="githubUrl" placeholder="留空则使用内置默认源">
            </div>
        </div>

        <div class="card">
            <div class="form-group">
                <label>网络层过滤与探测</label>
                <div class="list-item">
                    <div class="list-item-label">包含 IPv4 节点</div>
                    <label class="switch"><input type="checkbox" id="ipv4Enabled" checked><span class="slider"></span></label>
                </div>
                <div class="list-item">
                    <div class="list-item-label">包含 IPv6 节点</div>
                    <label class="switch"><input type="checkbox" id="ipv6Enabled" checked><span class="slider"></span></label>
                </div>
                <div class="list-item" style="border-bottom:none; padding-bottom:0;">
                    <div class="list-item-label" style="font-weight:600; font-size:14px; margin-top:8px; color:#86868b;">运营商运营商精确筛选</div>
                </div>
                <div class="list-item">
                    <div class="list-item-label">中国移动</div>
                    <label class="switch"><input type="checkbox" id="ispMobile" checked><span class="slider"></span></label>
                </div>
                <div class="list-item">
                    <div class="list-item-label">中国联通</div>
                    <label class="switch"><input type="checkbox" id="ispUnicom" checked><span class="slider"></span></label>
                </div>
                <div class="list-item">
                    <div class="list-item-label">中国电信</div>
                    <label class="switch"><input type="checkbox" id="ispTelecom" checked><span class="slider"></span></label>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="form-group">
                <label>一键下发配置订阅</label>
                <div class="btn-group">
                    <button type="button" onclick="generateClientLink('v2ray', '通用订阅')">复制通用订阅</button>
                    <button type="button" class="btn-secondary" onclick="generateClientLink('clash', 'Clash')">Clash 订阅</button>
                </div>
                <div class="btn-group" style="margin-top:12px;">
                    <button type="button" class="btn-secondary" onclick="generateClientLink('singbox', 'Sing-box')">Sing-box</button>
                    <button type="button" class="btn-secondary" onclick="generateClientLink('surge', 'Surge')">Surge</button>
                </div>
                <div id="clientSubscriptionUrl"></div>
            </div>
        </div>
    </div>

    <script>
        const SUB_CONVERTER_URL = "${scu}";
        let switches = {
            switchVL: true,
            switchTJ: false,
            switchVM: false,
            switchTLS: false
        };

        function addServerRow() {
            const container = document.getElementById('serverContainer');
            const row = document.createElement('div');
            row.className = 'server-row';
            row.style = 'display: flex; gap: 6px; margin-bottom: 12px; align-items: center;';
            row.innerHTML = `
                <input type="text" class="server-input s-domain" style="flex: 1; min-width: 0; padding: 10px; border-radius: 8px; border: 1px solid rgba(142,142,147,0.3); background: rgba(142,142,147,0.12); color: inherit;" placeholder="域名/主机名">
                <input type="text" class="server-input s-uuid" style="flex: 1; min-width: 0; padding: 10px; border-radius: 8px; border: 1px solid rgba(142,142,147,0.3); background: rgba(142,142,147,0.12); color: inherit;" placeholder="UUID/密码">
                <input type="text" class="server-input s-prefix" style="width: 80px; padding: 10px; border-radius: 8px; border: 1px solid rgba(142,142,147,0.3); background: rgba(142,142,147,0.12); color: inherit;" placeholder="前缀" value="Node">
                <button type="button" onclick="this.parentElement.remove()" style="width: 36px; height: 36px; background: #FF3B30; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; flex-shrink: 0; box-shadow: none; padding: 0;">-</button>
            `;
            container.appendChild(row);
        }

        function toggleSwitch(id) {
            switches[id] = document.getElementById(id).checked;
        }

        function generateClientLink(clientType, clientName) {
            const rows = document.querySelectorAll('.server-row');
            const configList = [];
            let isValid = true;

            rows.forEach(row => {
                const domain = row.querySelector('.s-domain').value.trim();
                const uuid = row.querySelector('.s-uuid').value.trim();
                const prefix = row.querySelector('.s-prefix').value.trim() || 'Node';
                if (!domain || !uuid) { isValid = false; return; }
                configList.push({ domain, uuid, prefix });
            });

            if (!isValid || configList.length === 0) {
                alert('请完整填写每一组主机的域名和UUID！');
                return;
            }
            if (!switches.switchVL && !switches.switchTJ && !switches.switchVM) {
                alert('请至少选择一个协议！');
                return;
            }
            
            const ipv4Enabled = document.getElementById('ipv4Enabled').checked;
            const ipv6Enabled = document.getElementById('ipv6Enabled').checked;
            const ispMobile = document.getElementById('ispMobile').checked;
            const ispUnicom = document.getElementById('ispUnicom').checked;
            const ispTelecom = document.getElementById('ispTelecom').checked;
            const customPath = document.getElementById('customPath').value.trim() || '/';
            const githubUrl = document.getElementById('githubUrl').value.trim();
            
            const base64Configs = btoa(encodeURIComponent(JSON.stringify(configList))).replace(/=/g, '');
            const currentUrl = new URL(window.location.href);
            
            let subscriptionUrl = \`\${currentUrl.origin}/aggregate/sub?configs=\${base64Configs}&epd=yes&epi=yes&egi=yes\`;
            
            if (githubUrl) subscriptionUrl += \`&piu=\${encodeURIComponent(githubUrl)}\`;
            if (switches.switchVL) subscriptionUrl += '&ev=yes';
            if (switches.switchTJ) subscriptionUrl += '&et=yes';
            if (switches.switchVM) subscriptionUrl += '&mess=yes';
            if (!ipv4Enabled) subscriptionUrl += '&ipv4=no';
            if (!ipv6Enabled) subscriptionUrl += '&ipv6=no';
            if (!ispMobile) subscriptionUrl += '&ispMobile=no';
            if (!ispUnicom) subscriptionUrl += '&ispUnicom=no';
            if (!ispTelecom) subscriptionUrl += '&ispTelecom=no';
            if (switches.switchTLS) subscriptionUrl += '&dkby=yes';
            if (customPath && customPath !== '/') subscriptionUrl += \`&path=\${encodeURIComponent(customPath)}\`;
            
            let finalUrl = subscriptionUrl;
            
            if (clientType === 'v2ray') {
                const urlElement = document.getElementById('clientSubscriptionUrl');
                urlElement.textContent = finalUrl;
                urlElement.style.display = 'block';
                navigator.clipboard.writeText(finalUrl).then(() => { alert(clientName + ' 订阅链接已复制'); });
            } else {
                const encodedUrl = encodeURIComponent(subscriptionUrl);
                finalUrl = SUB_CONVERTER_URL + '?target=' + clientType + '&url=' + encodedUrl + '&insert=false&emoji=true&list=false&xudp=false&udp=false&tfo=false&expand=true&scv=false&fdn=false&new_name=true';
                const urlElement = document.getElementById('clientSubscriptionUrl');
                urlElement.textContent = finalUrl;
                urlElement.style.display = 'block';
                navigator.clipboard.writeText(finalUrl).then(() => { alert(clientType.toUpperCase() + ' 订阅链接已复制'); });
            }
        }
    </script>
</body>
</html>`;
}

// 核心网络路由分发拦截层
addEventListener('fetch', event => {
    event.respondWith(handleEvent(event.request));
});

async function handleEvent(request) {
    try {
        const url = new URL(request.url);
        const path = url.pathname;

        // 路由1：多机矩阵网格化聚合传输
        if (path.includes('/aggregate/sub')) {
            let configs = [];
            try {
                const configParam = url.searchParams.get('configs');
                if (configParam) {
                    configs = JSON.parse(decodeURIComponent(atob(configParam)));
                }
            } catch (e) {
                return new Response('矩阵序列化解析异常', { status: 400 });
            }

            if (configs.length === 0) return new Response('无可读配置', { status: 400 });

            const target = url.searchParams.get('target') || 'base64';
            const piu = url.searchParams.get('piu') || defaultIPURL;
            const evEnabled = url.searchParams.get('ev') === 'yes';
            const etEnabled = url.searchParams.get('et') === 'yes';
            const vmEnabled = url.searchParams.get('mess') === 'yes';
            const ipv4Enabled = url.searchParams.get('ipv4') !== 'no';
            const ipv6Enabled = url.searchParams.get('ipv6') !== 'no';
            const ispMobile = url.searchParams.get('ispMobile') !== 'no';
            const ispUnicom = url.searchParams.get('ispUnicom') !== 'no';
            const ispTelecom = url.searchParams.get('ispTelecom') !== 'no';
            let disableNonTLS = url.searchParams.get('dkby') === 'yes';
            const customPath = url.searchParams.get('path') || '/';

            let aggregatedLinks = [];

            for (const config of configs) {
                const singleRes = await handleSubscriptionRequest(
                    request, config.uuid, config.domain, piu, ipv4Enabled, ipv6Enabled, 
                    ispMobile, ispUnicom, ispTelecom, evEnabled, etEnabled, vmEnabled, 
                    disableNonTLS, customPath, null
                );
                
                const rawText = await singleRes.text();
                let singleLinks = [];
                try {
                    singleLinks = atob(rawText).split('\n').filter(l => l.trim());
                } catch(err) {
                    singleLinks = rawText.split('\n').filter(l => l.trim());
                }

                let v4Count = 1;
                let v6Count = 1;
                
                const renamed = singleLinks.map(link => {
                    if (!link.includes('://')) return link;
                    const parts = link.split('#');
                    if (parts.length < 2) return link;
                    
                    const mainPart = parts[0];
                    let isV6 = false;
                    const atMatch = mainPart.match(/@([^:]+)/);
                    if (atMatch && atMatch[1] && atMatch[1].includes(':')) {
                        isV6 = true;
                    }
                    
                    const newName = isV6 
                        ? `${config.prefix}-${v6Count++}-V6`
                        : `${config.prefix}-${v4Count++}-V4`;
                        
                    return `${mainPart}#${encodeURIComponent(newName)}`;
                });
                
                aggregatedLinks.push(...renamed);
            }

            let subscriptionContent;
            let contentType = 'text/plain; charset=utf-8';
            
            switch (target.toLowerCase()) {
                case 'clash':
                case 'clashr':
                    subscriptionContent = generateClashConfig(aggregatedLinks);
                    contentType = 'text/yaml; charset=utf-8';
                    break;
                case 'surge':
                case 'surge2':
                case 'surge3':
                case 'surge4':
                    subscriptionContent = generateSurgeConfig(aggregatedLinks);
                    break;
                case 'quantumult':
                case 'quanx':
                    subscriptionContent = generateQuantumultConfig(aggregatedLinks);
                    break;
                default:
                    subscriptionContent = btoa(aggregatedLinks.join('\n'));
            }
            
            return new Response(subscriptionContent, {
                headers: { 
                    'Content-Type': contentType,
                    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
                },
            });
        }

        // 路由2：常规单节点传统订阅拦截格式 /{UUID或Password}/sub
        const pathMatch = path.match(/^\/([^\/]+)\/sub$/);
        if (pathMatch) {
            const uuid = pathMatch[1];
            const domain = url.searchParams.get('domain') || '';
            const piu = url.searchParams.get('piu') || defaultIPURL;
            const evEnabled = url.searchParams.get('ev') === 'yes' || url.searchParams.get('ev') === null;
            const etEnabled = url.searchParams.get('et') === 'yes';
            const vmEnabled = url.searchParams.get('mess') === 'yes';
            const ipv4Enabled = url.searchParams.get('ipv4') !== 'no';
            const ipv6Enabled = url.searchParams.get('ipv6') !== 'no';
            const ispMobile = url.searchParams.get('ispMobile') !== 'no';
            const ispUnicom = url.searchParams.get('ispUnicom') !== 'no';
            const ispTelecom = url.searchParams.get('ispTelecom') !== 'no';
            let disableNonTLS = url.searchParams.get('dkby') === 'yes';
            const customPath = url.searchParams.get('path') || '/';

            return await handleSubscriptionRequest(request, uuid, domain, piu, ipv4Enabled, ipv6Enabled, ispMobile, ispUnicom, ispTelecom, evEnabled, etEnabled, vmEnabled, disableNonTLS, customPath, null);
        }

        // 路由3：兜底拦截，只要直接访问根目录路径 '/'，直接推送前端 HTML 控制台界面
        return new Response(generateHomePage(scu), {
            headers: { 
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
            }
        });

    } catch (err) {
        return new Response(err.toString(), { status: 500 });
    }
}
