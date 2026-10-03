/**
 * Bilibili PlayViewUnite 播放流解锁插件 (Loon 纯净透明版)
 * 与 Cloudflare Worker 网关无缝对接
 */

// 自定义网关地址
const MY_GATEWAY_URL = "https://pilipili.hparkour0518.workers.dev/v1/playviewunite";

(async function () {
    const isLoon = typeof $loon !== "undefined";
    const req = typeof $request !== "undefined" ? $request : null;

    if (!req) {
        $done({});
        return;
    }

    // 1. 提取当前客户端的 UID (从 Header 或 Cookie 提取)
    let clientUid = "0";
    const headers = req.headers || {};
    
    // 优先从常见请求头提取
    for (const key of Object.keys(headers)) {
        const lowerKey = key.toLowerCase();
        if (lowerKey === "x-bili-mid" || lowerKey === "x-bili-aurora-eid") {
            clientUid = headers[key];
            break;
        }
    }
    
    // 若请求头没有，从 Cookie 中的 DedeUserID 提取
    if (clientUid === "0" && headers["Cookie"]) {
        const match = headers["Cookie"].match(/DedeUserID=(\d+)/);
        if (match) clientUid = match[1];
    }

    console.log(`[BiliBili] 开始中继播放请求 | UID: ${clientUid}`);

    // 2. 将二进制请求体转为 Base64
    let rawBodyBase64 = "";
    if (req.body) {
        if (typeof req.body === "string") {
            // 如果已经是字符串或经过编码
            rawBodyBase64 = btoa(req.body);
        } else {
            // 二进制 ArrayBuffer / Uint8Array
            const bytes = new Uint8Array(req.body);
            let binary = "";
            for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            rawBodyBase64 = btoa(binary);
        }
    }

    // 3. 构建发送给 Cloudflare Worker 的负载
    const payload = {
        uid: clientUid,
        target: req.url,
        body: rawBodyBase64,
        bodyEncoding: "base64"
    };

    // 4. 发起中继请求
    const postOptions = {
        url: MY_GATEWAY_URL,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "User-Agent": headers["User-Agent"] || headers["user-agent"] || "bili-universal/77100100"
        },
        body: JSON.stringify(payload),
        timeout: 10
    };

    const client = isLoon ? $httpClient : (typeof $task !== "undefined" ? $task : null);

    if (client && client.post) {
        client.post(postOptions, function (error, response, data) {
            if (error) {
                console.log(`[BiliBili] 中继请求失败: ${error}`);
                $done({});
                return;
            }

            try {
                const resJson = JSON.parse(data);
                
                // 处理权限拦截或每日限额超限
                if (response.status === 403 || resJson.error) {
                    console.log(`[BiliBili] 网关拦截: ${resJson.error || "权限拒绝"}`);
                    $done({});
                    return;
                }

                // 正常收到解锁流数据
                if (resJson.upstream && resJson.upstream.body) {
                    console.log(`[BiliBili] 中继成功，状态码: ${resJson.upstream.status}`);
                    
                    // 将 base64 数据还原回二进制字节
                    const binStr = atob(resJson.upstream.body);
                    const len = binStr.length;
                    const bytes = new Uint8Array(len);
                    for (let i = 0; i < len; i++) {
                        bytes[i] = binStr.charCodeAt(i);
                    }

                    $done({
                        response: {
                            status: resJson.upstream.status,
                            headers: resJson.upstream.headers,
                            body: bytes.buffer
                        }
                    });
                    return;
                }
            } catch (e) {
                console.log(`[BiliBili] 数据解析异常: ${e}`);
            }

            $done({});
        });
    } else {
        $done({});
    }
})();
