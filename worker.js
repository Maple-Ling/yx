// Cloudflare Worker - 多服务器优选工具
// 修复并重构：支持多服务器同时订阅，支持自定义节点前缀与 V4/V6 自动编号计数

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

// 工具函数：判断是否是IPv6
function isIPv6(ip) {
    return ip.includes(':');
}

// 获取动态IP列表（支持IPv4/IPv6和运营商筛选）
async function fetchDynamicIPs(ipv4Enabled = true, ipv6Enabled = true, ispMobile = true, ispUnicom = true, ispTelecom = true) {
    const v4Url = "https://www.wetest.vip/page/cloudflare/address_v4.html";
    const v6Url = "https://www.wetest.vip/page/cloudflare/address_v6.html";
    let results = [];

    try {
        const fetchPromises = [];
        if (ipv4Enabled) fetchPromises.push(fetchAndParseWetest(v4Url));
        else fetchPromises.push(Promise.resolve([]));
        
        if (ipv6Enabled) fetchPromises.push(fetchAndParseWetest(v6Url));
        else fetchPromises.push(Promise.resolve([]));

        const [ipv4List, ipv6List] = await Promise.all(fetchPromises);
        results = [...ipv4List, ...ipv6List];
        
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

async function 整理成数组(内容) {
    var 替换后的内容 = 内容.replace(/[	"'\r\n]+/g, ',').replace(/,+/g, ',');
    if (替换后的内容.charAt(0) == ',') 替换后的内容 = 替换后的内容.slice(1);
    if (替换后的内容.charAt(替换后的内容.length - 1) == ',') 替换后的内容 = 替换后的内容.slice(0, 替换后的内容.length - 1);
    return 替换后的内容.split(',');
}

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

                let decoders = ['utf-8', 'gb2312'];
                if (charset.includes('gb') || charset.includes('gbk') || charset.includes('gb2312')) {
                    decoders = ['gb2312', 'utf-8'];
                }

                let decodeSuccess = false;
                for (const decoder of decoders) {
                    try {
                        const decoded = new TextDecoder(decoder).decode(buffer);
                        if (decoded && decoded.length > 0 && !decoded.includes('\ufffd')) {
                            text = decoded;
                            decodeSuccess = true;
                            break;
                        }
                    } catch (e) {}
                }
                if (!decodeSuccess) text = await response.text();
                if (!text || text.trim().length === 0) return;
            } catch (e) {
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
                    dataLines.forEach(line => {
                        const cols = line.split(',').map(c => c.trim());
                        const wrappedIP = IPV6_PATTERN.test(cols[ipIdx]) ? `[${cols[ipIdx]}]` : cols[ipIdx];
                        results.add(`${wrappedIP}:${cols[portIdx]}`);
                    });
                } else if (headers.some(h => h.includes('IP')) && headers.some(h => h.includes('延迟')) && headers.some(h => h.includes('下载速度'))) {
                    const ipIdx = headers.findIndex(h => h.includes('IP'));
                    const port = new URL(url).searchParams.get('port') || 默认端口;
                    dataLines.forEach(line => {
                        const cols = line.split(',').map(c => c.trim());
                        const wrappedIP = IPV6_PATTERN.test(cols[ipIdx]) ? `[${cols[ipIdx]}]` : cols[ipIdx];
                        results.add(`${wrappedIP}:${port}`);
                    });
                }
            }
        } catch (e) { }
    }));
    return Array.from(results);
}

async function fetchAndParseNewIPs(piu) {
    const url = piu || defaultIPURL;
    try {
        const response = await fetch(url);
        if (!response.ok) return [];
        const text = await response.text();
        const results = [];
        const lines = text.trim().replace(/\r/g, "").split('\n');
        const regex = /^([^:]+):(\d+)(?:#(.*))?$/;

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;
            const match = trimmedLine.match(regex);
            if (match) {
                results.push({
                    ip: match[1],
                    port: parseInt(match[2], 10)
                });
            }
        }
        return results;
    } catch (error) {
        return [];
    }
}

// 辅助生成节点统一名称
function getFormatedNodeName(prefix, counter, ip, port, suffix) {
    const vType = isIPv6(ip) ? 'V6' : 'V4';
    const index = counter[vType]++;
    return `${prefix}-${index}-${vType}-${port}-${suffix}`;
}

// 生成VLESS链接
function generateLinksFromSource(list, user, workerDomain, disableNonTLS = false, customPath = '/', echConfig = null, prefix = 'Node', counter) {
    const CF_HTTP_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095];
    const CF_HTTPS_PORTS = [443, 2053, 2083, 2087, 2096, 8443];
    const defaultHttpsPorts = [443];
    const defaultHttpPorts = disableNonTLS ? [] : [80];
    const links = [];
    const wsPath = customPath || '/';

    list.forEach(item => {
        const safeIP = item.ip.includes(':') ? `[${item.ip}]` : item.ip;
        let portsToGenerate = [];
        
        if (item.port) {
            const port = item.port;
            if (CF_HTTPS_PORTS.includes(port)) portsToGenerate.push({ port, tls: true });
            else if (CF_HTTP_PORTS.includes(port)) portsToGenerate.push({ port, tls: false });
            else portsToGenerate.push({ port, tls: true });
        } else {
            defaultHttpsPorts.forEach(port => portsToGenerate.push({ port, tls: true }));
            defaultHttpPorts.forEach(port => portsToGenerate.push({ port, tls: false }));
        }

        portsToGenerate.forEach(({ port, tls }) => {
            const suffix = tls ? 'WS-TLS' : 'WS';
            const nodeName = getFormatedNodeName(prefix, counter, item.ip, port, suffix);
            
            const wsParams = new URLSearchParams({ 
                encryption: 'none', 
                security: tls ? 'tls' : 'none', 
                type: 'ws', 
                host: workerDomain, 
                path: wsPath
            });
            if (tls) {
                wsParams.set('sni', workerDomain);
                wsParams.set('fp', 'chrome');
                if (echConfig) {
                    wsParams.set('alpn', 'h3,h2,http/1.1');
                    wsParams.set('ech', echConfig);
                }
            }
            links.push(`vless://${user}@${safeIP}:${port}?${wsParams.toString()}#${encodeURIComponent(nodeName)}`);
        });
    });
    return links;
}

// 生成Trojan链接
async function generateTrojanLinksFromSource(list, user, workerDomain, disableNonTLS = false, customPath = '/', echConfig = null, prefix = 'Node', counter) {
    const CF_HTTP_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095];
    const CF_HTTPS_PORTS = [443, 2053, 2083, 2087, 2096, 8443];
    const defaultHttpsPorts = [443];
    const defaultHttpPorts = disableNonTLS ? [] : [80];
    const links = [];
    const wsPath = customPath || '/';

    list.forEach(item => {
        const safeIP = item.ip.includes(':') ? `[${item.ip}]` : item.ip;
        let portsToGenerate = [];
        
        if (item.port) {
            const port = item.port;
            if (CF_HTTPS_PORTS.includes(port)) portsToGenerate.push({ port, tls: true });
            else if (CF_HTTP_PORTS.includes(port)) { if (!disableNonTLS) portsToGenerate.push({ port, tls: false }); }
            else portsToGenerate.push({ port, tls: true });
        } else {
            defaultHttpsPorts.forEach(port => portsToGenerate.push({ port, tls: true }));
            defaultHttpPorts.forEach(port => portsToGenerate.push({ port, tls: false }));
        }

        portsToGenerate.forEach(({ port, tls }) => {
            const suffix = tls ? 'Trojan-WS-TLS' : 'Trojan-WS';
            const nodeName = getFormatedNodeName(prefix, counter, item.ip, port, suffix);

            const wsParams = new URLSearchParams({ 
                security: tls ? 'tls' : 'none', 
                type: 'ws', 
                host: workerDomain, 
                path: wsPath
            });
            if (tls) {
                wsParams.set('sni', workerDomain);
                wsParams.set('fp', 'chrome');
                if (echConfig) {
                    wsParams.set('alpn', 'h3,h2,http/1.1');
                    wsParams.set('ech', echConfig);
                }
            }
            links.push(`trojan://${user}@${safeIP}:${port}?${wsParams.toString()}#${encodeURIComponent(nodeName)}`);
        });
    });
    return links;
}

// 生成VMess链接
function generateVMessLinksFromSource(list, user, workerDomain, disableNonTLS = false, customPath = '/', echConfig = null, prefix = 'Node', counter) {
    const CF_HTTP_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095];
    const CF_HTTPS_PORTS = [443, 2053, 2083, 2087, 2096, 8443];
    const defaultHttpsPorts = [443];
    const defaultHttpPorts = disableNonTLS ? [] : [80];
    const links = [];
    const wsPath = customPath || '/';

    list.forEach(item => {
        const safeIP = item.ip.includes(':') ? `[${item.ip}]` : item.ip;
        let portsToGenerate = [];
        
        if (item.port) {
            const port = item.port;
            if (CF_HTTPS_PORTS.includes(port)) portsToGenerate.push({ port, tls: true });
            else if (CF_HTTP_PORTS.includes(port)) { if (!disableNonTLS) portsToGenerate.push({ port, tls: false }); }
            else portsToGenerate.push({ port, tls: true });
        } else {
            defaultHttpsPorts.forEach(port => portsToGenerate.push({ port, tls: true }));
            defaultHttpPorts.forEach(port => portsToGenerate.push({ port, tls: false }));
        }

        portsToGenerate.forEach(({ port, tls }) => {
            const suffix = tls ? 'VMess-WS-TLS' : 'VMess-WS';
            const nodeName = getFormatedNodeName(prefix, counter, item.ip, port, suffix);

            const vmessConfig = {
                v: "2",
                ps: nodeName,
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
            
            const jsonStr = JSON.stringify(vmessConfig);
            const vmessBase64 = btoa(encodeURIComponent(jsonStr).replace(/%([0-9A-F]{2})/g, (match, p1) => String.fromCharCode('0x' + p1)));
            links.push(`vmess://${vmessBase64}`);
        });
    });
    return links;
}

// 处理单台机器的所有节点获取
async function processSingleConfig(config, globalParams, requestUrlObj) {
    const finalLinks = [];
    const workerDomain = requestUrlObj.hostname;
    const nodeDomain = config.domain || workerDomain;
    const user = config.uuid;
    const prefix = config.prefix || 'Node';
    const wsPath = config.path || '/';

    // 每台机器初始化独立的递增计数器
    const counter = { V4: 1, V6: 1 };

    const { evEnabled, etEnabled, vmEnabled, disableNonTLS, echConfig, ipv4Enabled, ipv6Enabled, ispMobile, ispUnicom, ispTelecom, piu } = globalParams;

    async function addNodesFromList(list) {
        const hasProtocol = evEnabled || etEnabled || vmEnabled;
        const useVL = hasProtocol ? evEnabled : true;
        
        if (useVL) finalLinks.push(...generateLinksFromSource(list, user, nodeDomain, disableNonTLS, wsPath, echConfig, prefix, counter));
        if (etEnabled) finalLinks.push(...await generateTrojanLinksFromSource(list, user, nodeDomain, disableNonTLS, wsPath, echConfig, prefix, counter));
        if (vmEnabled) finalLinks.push(...generateVMessLinksFromSource(list, user, nodeDomain, disableNonTLS, wsPath, echConfig, prefix, counter));
    }

    // 1. 原生地址
    await addNodesFromList([{ ip: nodeDomain, isp: '原生' }]);

    // 2. 优选域名
    if (epd) {
        const domainList = directDomains.map(d => ({ ip: d.domain }));
        await addNodesFromList(domainList);
    }

    // 3. 优选IP
    if (epi) {
        try {
            const dynamicIPList = await fetchDynamicIPs(ipv4Enabled, ipv6Enabled, ispMobile, ispUnicom, ispTelecom);
            if (dynamicIPList.length > 0) await addNodesFromList(dynamicIPList);
        } catch (e) {}
    }

    // 4. GitHub优选 / 优选API
    if (egi) {
        try {
            if (piu && piu.toLowerCase().startsWith('https://')) {
                const apiIPs = await 请求优选API([piu]);
                if (apiIPs.length > 0) {
                    const parsed = apiIPs.map(addr => {
                        const regex = /^(\[[\da-fA-F:]+\]|[\d.]+|[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*)(?::(\d+))?/;
                        const match = addr.match(regex);
                        if (match) {
                            return { ip: match[1].replace(/[\[\]]/g, ''), port: parseInt(match[2] || '443') };
                        }
                        return null;
                    }).filter(Boolean);
                    if (parsed.length > 0) await addNodesFromList(parsed);
                }
            } else {
                const newIPList = await fetchAndParseNewIPs(piu);
                if (newIPList.length > 0) await addNodesFromList(newIPList);
            }
        } catch (e) {}
    }

    return finalLinks;
}

// 订阅聚合生成
async function handleSubscriptionRequest(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get('target') || 'base64';
    
    // 解析聚合配置参数
    let configs = [];
    try {
        const configParam = url.searchParams.get('configs');
        if (configParam) {
            configs = JSON.parse(decodeURIComponent(atob(configParam)));
        }
    } catch (e) {
        return new Response('配置解析错误', { status: 400 });
    }

    if (configs.length === 0) {
        return new Response('未检测到有效的服务器配置信息', { status: 400 });
    }

    // 全局控制参数提取
    epd = url.searchParams.get('epd') !== 'no';
    epi = url.searchParams.get('epi') !== 'no';
    egi = url.searchParams.get('egi') !== 'no';
    const piu = url.searchParams.get('piu') || defaultIPURL;
    
    const globalParams = {
        evEnabled: url.searchParams.get('ev') === 'yes',
        etEnabled: url.searchParams.get('et') === 'yes',
        vmEnabled: url.searchParams.get('mess') === 'yes',
        ipv4Enabled: url.searchParams.get('ipv4') !== 'no',
        ipv6Enabled: url.searchParams.get('ipv6') !== 'no',
        ispMobile: url.searchParams.get('ispMobile') !== 'no',
        ispUnicom: url.searchParams.get('ispUnicom') !== 'no',
        ispTelecom: url.searchParams.get('ispTelecom') !== 'no',
        disableNonTLS: url.searchParams.get('dkby') === 'yes',
        piu: piu,
        echConfig: null
    };

    if (url.searchParams.get('ech') === 'yes') {
        globalParams.disableNonTLS = true;
        const dnsVal = url.searchParams.get('customDNS') || customDNS;
        const domVal = url.searchParams.get('customECHDomain') || customECHDomain;
        globalParams.echConfig = `${domVal}+${dnsVal}`;
    }

    // 循环遍历所有机器，并将结果合并
    let totalLinks = [];
    for (const config of configs) {
        const links = await processSingleConfig(config, globalParams, url);
        totalLinks.push(...links);
    }

    if (totalLinks.length === 0) {
        totalLinks.push(`vless://00000000-0000-0000-0000-000000000000@127.0.0.1:80?encryption=none&security=none&type=ws&host=error.com&path=%2F#%E6%89%80%E6%9C%89%E8%8A%82%E7%82%B9%E8%8E%B7%E5%8F%96%E5%A4%B1%E8%B4%A5`);
    }

    let subscriptionContent;
    let contentType = 'text/plain; charset=utf-8';
    
    switch (target.toLowerCase()) {
        case 'clash':
        case 'clashr':
            subscriptionContent = generateClashConfig(totalLinks);
            contentType = 'text/yaml; charset=utf-8';
            break;
        case 'surge':
        case 'surge2':
        case 'surge3':
        case 'surge4':
            subscriptionContent = generateSurgeConfig(totalLinks);
            break;
        case 'quantumult':
        case 'quanx':
            subscriptionContent = btoa(totalLinks.join('\n'));
            break;
        default:
            subscriptionContent = btoa(totalLinks.join('\n'));
    }
    
    return new Response(subscriptionContent, {
        headers: { 
            'Content-Type': contentType,
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
    });
}

function generateClashConfig(links) {
    let yaml = 'port: 7890\nsocks-port: 7891\nallow-lan: false\nmode: rule\nlog-level: info\n\nproxies:\n';
    const proxyNames = [];
    links.forEach((link, index) => {
        if(!link.startsWith('vless://')) return; 
        const name = decodeURIComponent(link.split('#')[1] || `节点${index + 1}`);
        proxyNames.push(name);
        const server = link.match(/@([^:]+):(\d+)/)?.[1] || '';
        const port = link.match(/@[^:]+:(\d+)/)?.[1] || '443';
        const uuid = link.match(/vless:\/\/([^@]+)@/)?.[1] || '';
        const tls = link.includes('security=tls');
        const path = link.match(/path=([^&#]+)/)?.[1] || '/';
        const host = link.match(/host=([^&#]+)/)?.[1] || '';
        const sni = link.match(/sni=([^&#]+)/)?.[1] || '';
        
        yaml += `  - name: "${name}"\n    type: vless\n    server: ${server}\n    port: ${port}\n    uuid: ${uuid}\n    tls: ${tls}\n    network: ws\n    ws-opts:\n      path: ${path}\n      headers:\n        Host: ${host}\n`;
        if (sni) yaml += `    servername: ${sni}\n`;
    });
    yaml += '\nproxy-groups:\n  - name: PROXY\n    type: select\n    proxies: [' + proxyNames.map(n => `"${n}"`).join(', ') + ']\nrules:\n  - DOMAIN-SUFFIX,local,DIRECT\n  - IP-CIDR,127.0.0.0/8,DIRECT\n  - GEOIP,CN,DIRECT\n  - MATCH,PROXY\n';
    return yaml;
}

function generateSurgeConfig(links) {
    let config = '[Proxy]\n';
    links.forEach(link => {
        if(!link.startsWith('vless://')) return;
        const name = decodeURIComponent(link.split('#')[1] || '节点');
        config += `${name} = vless, ${link.match(/@([^:]+):(\d+)/)?.[1] || ''}, ${link.match(/@[^:]+:(\d+)/)?.[1] || '443'}, username=${link.match(/vless:\/\/([^@]+)@/)?.[1] || ''}, tls=${link.includes('security=tls')}, ws=true, ws-path=${link.match(/path=([^&#]+)/)?.[1] || '/'}, ws-headers=Host:${link.match(/host=([^&#]+)/)?.[1] || ''}\n`;
    });
    return config;
}

// 主页HTML生成（动态增减多服务器界面）
function generateHomePage(scuValue) {
    const scu = scuValue || 'https://url.v1.mk/sub';
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>多服务器优选订阅工具</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', Arial, sans-serif; background: #f5f5f7; color: #1d1d1f; padding: 20px; }
        .container { max-width: 700px; margin: 0 auto; }
        .header { text-align: center; padding: 30px 0 20px; }
        .header h1 { font-size: 32px; font-weight: 700; }
        .card { background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(20px); border-radius: 20px; padding: 24px; margin-bottom: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); border: 0.5px solid rgba(0,0,0,0.08); }
        .section-title { font-size: 14px; font-weight: 600; color: #86868b; text-transform: uppercase; margin-bottom: 12px; letter-spacing: 0.5px; }
        
        /* 动态多列服务器输入框样式 */
        .server-row { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; background: rgba(0,0,0,0.02); padding: 10px; border-radius: 12px; border: 0.5px solid rgba(0,0,0,0.05); }
        .server-input { flex: 1; min-width: 0; padding: 10px 12px; font-size: 14px; background: #fff; border: 1px solid rgba(0,0,0,0.15); border-radius: 8px; outline: none; }
        .server-input:focus { border-color: #007AFF; }
        .btn-action { padding: 10px; border: none; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; width: 38px; height: 38px; }
        .btn-add { background: #34C759; color: white; }
        .btn-del { background: #FF3B30; color: white; }

        .list-item { display: flex; align-items: center; justify-content: space-between; padding: 14px 0; border-bottom: 0.5px solid rgba(0, 0, 0, 0.08); cursor: pointer; }
        .list-item:last-child { border-bottom: none; }
        .switch { position: relative; width: 51px; height: 31px; background: rgba(142, 142, 147, 0.3); border-radius: 16px; transition: background 0.3s; }
        .switch.active { background: #34C759; }
        .switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 27px; height: 27px; background: white; border-radius: 50%; transition: transform 0.3s; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
        .switch.active::after { transform: translateX(20px); }
        
        .client-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-top: 10px; }
        .client-btn { padding: 12px; font-size: 14px; font-weight: 500; color: #007AFF; background: rgba(0, 122, 255, 0.08); border: 1px solid rgba(0, 122, 255, 0.15); border-radius: 10px; cursor: pointer; text-align: center; }
        .client-btn:active { transform: scale(0.98); background: rgba(0, 122, 255, 0.15); }
        
        .checkbox-group { display: flex; gap: 16px; margin-top: 8px; }
        .checkbox-label { display: flex; align-items: center; gap: 6px; font-size: 15px; cursor: pointer; }
        .checkbox-label input { width: 18px; height: 18px; }
        
        .result-url { display: none; margin-top: 15px; padding: 12px; background: rgba(0, 122, 255, 0.08); border-radius: 10px; font-size: 13px; color: #007aff; word-break: break-all; border: 0.5px solid rgba(0, 122, 255, 0.2); }
        @media (max-width: 600px) { .server-row { flex-direction: column; align-items: stretch; } .btn-action { width: 100%; height: 35px; } }
        @media (prefers-color-scheme: dark) {
            body { background: #000; color: #fff; }
            .card { background: #1c1c1e; border-color: rgba(255,255,255,0.1); }
            .server-input { background: #2c2c2e; border-color: rgba(255,255,255,0.2); color: #fff; }
            .switch { background: rgba(255,255,255,0.2); }
            .list-item { border-bottom-color: rgba(255,255,255,0.1); }
            .result-url { background: rgba(10, 132, 255, 0.15); color: #409eff; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>多服务器优选订阅</h1>
        </div>
        
        <div class="card">
            <div class="section-title">服务器矩阵列表</div>
            <div id="serverContainer">
                <div class="server-row">
                    <input type="text" class="server-input s-domain" placeholder="域名/主机名">
                    <input type="text" class="server-input s-uuid" placeholder="UUID/密码">
                    <input type="text" class="server-input s-prefix" placeholder="节点前缀(如JP)" value="Node">
                    <input type="text" class="server-input s-path" placeholder="路径(/)" value="/">
                    <button class="btn-action btn-add" onclick="addServerRow()">+</button>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="section-title">功能开关控制</div>
            <div class="list-item" onclick="toggleSwitch('switchDomain')"><span>启用优选域名</span><div class="switch active" id="switchDomain"></div></div>
            <div class="list-item" onclick="toggleSwitch('switchIP')"><span>启用优选IP</span><div class="switch active" id="switchIP"></div></div>
            <div class="list-item" onclick="toggleSwitch('switchGitHub')"><span>启用GitHub优选</span><div class="switch active" id="switchGitHub"></div></div>
            <div class="list-item" onclick="toggleSwitch('switchVL')"><span>协议: VLESS</span><div class="switch active" id="switchVL"></div></div>
            <div class="list-item" onclick="toggleSwitch('switchTJ')"><span>协议: Trojan</span><div class="switch" id="switchTJ"></div></div>
            <div class="list-item" onclick="toggleSwitch('switchVM')"><span>协议: VMess</span><div class="switch" id="switchVM"></div></div>
            <div class="list-item" onclick="toggleSwitch('switchTLS')"><span>仅生成 TLS 节点</span><div class="switch" id="switchTLS"></div></div>
            <div class="list-item" onclick="toggleSwitch('switchECH')"><span>启用 ECH 安全扩展</span><div class="switch" id="switchECH"></div></div>
        </div>

        <div class="card">
            <div class="section-title">网络细分筛选</div>
            <div style="margin-bottom: 12px;">
                <span style="font-size:13px; color:#86868b;">IP协议:</span>
                <div class="checkbox-group">
                    <label class="checkbox-label"><input type="checkbox" id="ipv4Enabled" checked>IPv4</label>
                    <label class="checkbox-label"><input type="checkbox" id="ipv6Enabled" checked>IPv6</label>
                </div>
            </div>
            <div>
                <span style="font-size:13px; color:#86868b;">国内运营商:</span>
                <div class="checkbox-group">
                    <label class="checkbox-label"><input type="checkbox" id="ispMobile" checked>移动</label>
                    <label class="checkbox-label"><input type="checkbox" id="ispUnicom" checked>联通</label>
                    <label class="checkbox-label"><input type="checkbox" id="ispTelecom" checked>电信</label>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="section-title">生成客户端订阅</div>
            <div class="client-grid">
                <button class="client-btn" onclick="generateSub('clash')">CLASH</button>
                <button class="client-btn" onclick="generateSub('base64')">V2RAY / XRAY</button>
                <button class="client-btn" onclick="generateSub('sing-box')">SING-BOX</button>
                <button class="client-btn" onclick="generateSub('surge')">SURGE</button>
            </div>
            <div class="result-url" id="resultUrl"></div>
        </div>
    </div>

    <script>
        let switches = { switchDomain: true, switchIP: true, switchGitHub: true, switchVL: true, switchTJ: false, switchVM: false, switchTLS: false, switchECH: false };
        const SUB_CONVERTER_URL = "${scu}";

        function toggleSwitch(id) {
            switches[id] = !switches[id];
            document.getElementById(id).classList.toggle('active');
            if (id === 'switchECH' && switches.switchECH && !switches.switchTLS) {
                switches.switchTLS = true;
                document.getElementById('switchTLS').classList.add('active');
            }
        }

        function addServerRow() {
            const container = document.getElementById('serverContainer');
            const row = document.createElement('div');
            row.className = 'server-row';
            row.innerHTML = \`
                <input type="text" class="server-input s-domain" placeholder="域名/主机名">
                <input type="text" class="server-input s-uuid" placeholder="UUID/密码">
                <input type="text" class="server-input s-prefix" placeholder="节点前缀(如JP)" value="Node">
                <input type="text" class="server-input s-path" placeholder="路径(/)" value="/">
                <button class="btn-action btn-del" onclick="this.parentElement.remove()">-</button>
            \`;
            container.appendChild(row);
        }

        function generateSub(clientType) {
            const rows = document.querySelectorAll('.server-row');
            const configList = [];
            let isValid = true;

            rows.forEach(row => {
                const domain = row.querySelector('.s-domain').value.trim();
                const uuid = row.querySelector('.s-uuid').value.trim();
                const prefix = row.querySelector('.s-prefix').value.trim() || 'Node';
                const path = row.querySelector('.s-path').value.trim() || '/';

                if (!domain || !uuid) {
                    isValid = false;
                    return;
                }
                configList.push({ domain, uuid, prefix, path });
            });

            if (!isValid || configList.length === 0) {
                alert('请完整填写至少一组主机的域名和UUID！');
                return;
            }

            if (!switches.switchVL && !switches.switchTJ && !switches.switchVM) {
                alert('请至少开启一种传输协议！');
                return;
            }

            // 打包数据
            const base64Configs = btoa(encodeURIComponent(JSON.stringify(configList)));
            const currentUrl = new URL(window.location.href);
            
            let queryUrl = \`\${currentUrl.origin}/aggregate/sub?configs=\${base64Configs}\`;
            queryUrl += \`&epd=\${switches.switchDomain?'yes':'no'}&epi=\${switches.switchIP?'yes':'no'}&egi=\${switches.switchGitHub?'yes':'no'}\`;
            if (switches.switchVL) queryUrl += '&ev=yes';
            if (switches.switchTJ) queryUrl += '&et=yes';
            if (switches.switchVM) queryUrl += '&mess=yes';
            if (switches.switchTLS) queryUrl += '&dkby=yes';
            if (switches.switchECH) queryUrl += '&ech=yes';
            
            if (!document.getElementById('ipv4Enabled').checked) queryUrl += '&ipv4=no';
            if (!document.getElementById('ipv6Enabled').checked) queryUrl += '&ipv6=no';
            if (!document.getElementById('ispMobile').checked) queryUrl += '&ispMobile=no';
            if (!document.getElementById('ispUnicom').checked) queryUrl += '&ispUnicom=no';
            if (!document.getElementById('ispTelecom').checked) queryUrl += '&ispTelecom=no';

            let finalUrl = queryUrl;
            if (clientType !== 'base64') {
                finalUrl = SUB_CONVERTER_URL + '?target=' + clientType + '&url=' + encodeURIComponent(queryUrl) + '&insert=false&emoji=true&expand=true&new_name=true';
            }

            const resDiv = document.getElementById('resultUrl');
            resDiv.textContent = finalUrl;
            resDiv.style.display = 'block';

            navigator.clipboard.writeText(finalUrl).then(() => {
                alert('万能聚合订阅链接已成功复制到剪贴板！');
            });
        }
    </script>
</body>
</html>`;
}

// 路由分发处理器
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;
        
        if (path === '/' || path === '') {
            const scuValue = env?.scu || scu;
            return new Response(generateHomePage(scuValue), {
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
        }
        
        // 捕获统一聚合订阅请求
        if (path.endsWith('/sub')) {
            return await handleSubscriptionRequest(request);
        }
        
        return new Response('Not Found', { status: 404 });
    }
};
