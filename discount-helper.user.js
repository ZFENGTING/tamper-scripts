// ==UserScript==
// @name         折扣自动计算助手 v2.0.20250402
// @copyright    2025, ZFT (https://github.com/ZFENGTING)
// @namespace    https://github.com/ZFENGTING
// @version      v2.0.20250402
// @description  支持普通页和变体页折扣结构，稳定处理所有商品行
// @match        http://ns71.bosonapp.com/boson/module/sale/sale_reg.php*
// @updateURL    https://raw.githubusercontent.com/ZFENGTING/tamper-scripts/main/discount-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/ZFENGTING/tamper-scripts/main/discount-helper.user.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    waitForPageReady();

    function waitForPageReady() {
        const waitForAllButton = () => {
            const allBtn = document.querySelector('a[title="全部"]');
            if (allBtn) {
                allBtn.click();
                waitForTableRender();
            } else {
                setTimeout(waitForAllButton, 300);
            }
        };

        const waitForTableRender = () => {
            const productReady = document.querySelector('input[name^="product_model"]');
            if (productReady) {
                waitForTotalAmount();
            } else {
                setTimeout(waitForTableRender, 300);
            }
        };

        const waitForTotalAmount = () => {
            const totalElem = document.querySelector('#document_sum_show .document_sum_font') || 
                             document.querySelector('#document_sum_show i.document_sum_font');
            
            if (totalElem && totalElem.textContent) {
                console.log('✅ 商品数据和总金额加载完成，初始化浮窗');
                initDiscountScript();
            } else {
                console.log('⏳ 等待总金额加载...');
                setTimeout(waitForTotalAmount, 300);
            }
        };

        waitForAllButton();
    }

    function initDiscountScript() {
        const totalElem = document.querySelector('#document_sum_show .document_sum_font') || 
                         document.querySelector('#document_sum_show i.document_sum_font');
        
        if (!totalElem || !totalElem.textContent) {
            console.error('❌ 无法获取总金额元素');
            return;
        }

        const totalAmount = parseFloat(totalElem.textContent.trim());
        let amountDiscount = 0;

        if (totalAmount >= 8000) amountDiscount = 7;
        else if (totalAmount >= 6000) amountDiscount = 5;
        else if (totalAmount >= 3500) amountDiscount = 3;

        const remarkText = document.querySelector('#document_remark')?.value || '';
        const amountChecked = amountDiscount > 0 ? 'checked' : '';
        const warningText = totalAmount < 3500 ? '<span style="color:#ff6b6b;font-size:12px;margin-left:5px;">⚠️ 订单金额低于3500€</span>' : '';

        const panel = document.createElement('div');
        panel.id = 'discount_panel';
        panel.style.cssText = `
            position: fixed;
            top: 50px;
            left: 50px;
            z-index: 9999;
            background: #f0f0f0;
            padding: 10px 15px;
            border: 1px solid #ccc;
            border-radius: 8px;
            box-shadow: 0 0 10px rgba(0,0,0,0.1);
            font-size: 14px;
            cursor: move;
            width: 360px;
        `;

        panel.innerHTML = `
            <div><b>💬 备注内容：</b><div style="white-space:pre-wrap;margin:4px 0 10px 0;">${remarkText}</div></div>
            <b>💰 订单金额：</b>${totalAmount.toFixed(2)} EUR，
            推荐折扣：<input type="number" id="custom_discount" value="${amountDiscount}" min="0" max="100" step="0.5" style="width:50px;text-align:right">%<br/><br/>
            <div id="last_result" style="margin-bottom:10px;font-size:12px;color:#666;"></div>
            <label><input type="checkbox" id="amount_flag" ${amountChecked}> 应用金额折扣${warningText}</label><br/>
            <label><input type="checkbox" id="presale_flag"> 应用预售订单折扣</label><br/>
            <label><input type="checkbox" id="cash_flag"> 应用现金支付折扣</label><br/><br/>
            <button id="apply_discount_btn">应用折扣</button>
            <div id="progress_text" style="margin-top:8px;color:#666;font-size:13px;"></div>
        `;

        document.body.appendChild(panel);
        makeDraggable(panel);

        // 添加更新上次处理结果的函数
        function updateLastResult(updated, skipped, total) {
            const lastResult = document.getElementById('last_result');
            if (lastResult) {
                lastResult.innerHTML = `📊 上次处理结果：
- 修改：${updated} 个
- 跳过：${skipped} 个
- 未改：${total - updated - skipped} 个
- 总数：${total} 个`;
            }
        }

        // 添加请求监控
        const originalXHR = window.XMLHttpRequest.prototype.open;
        window.XMLHttpRequest.prototype.open = function() {
            const xhr = this;
            const originalSend = xhr.send;
            xhr.send = function() {
                return new Promise((resolve, reject) => {
                    xhr.addEventListener('load', function() {
                        if (this.responseURL.includes('sale_item_reg.php')) {
                            if (this.status === 200) {
                                console.log('✅ 折扣修改请求成功 (XHR)');
                                resolve(true);
                            } else {
                                console.error('❌ 折扣修改请求失败 (XHR)');
                                reject(new Error('XHR request failed'));
                            }
                        }
                    });
                    return originalSend.apply(xhr, arguments);
                });
            };
            return originalXHR.apply(this, arguments);
        };

        // 创建请求队列
        const requestQueue = [];
        let isProcessing = false;
        const BATCH_SIZE = 1; // 改为1，确保每次只处理一个请求

        async function processQueue() {
            if (isProcessing || requestQueue.length === 0) return;
            
            isProcessing = true;
            const batch = requestQueue.splice(0, BATCH_SIZE);
            
            try {
                for (const request of batch) {
                    await request();
                    await new Promise(resolve => setTimeout(resolve, 10)); // 添加100ms延迟
                }
                console.log(`✅ 成功处理 ${batch.length} 个请求`);
            } catch (error) {
                console.error('❌ 批量处理请求失败:', error);
            } finally {
                isProcessing = false;
                if (requestQueue.length > 0) {
                    processQueue(); // 继续处理队列中的下一个请求
                }
            }
        }

        document.getElementById('apply_discount_btn').addEventListener('click', async () => {
            const btn = document.getElementById('apply_discount_btn');
            const progressText = document.getElementById('progress_text');
            
            // 禁用按钮，修改文字
            btn.disabled = true;
            btn.textContent = '处理中...';
            
            const useAmount = document.getElementById('amount_flag')?.checked;
            const usePresale = document.getElementById('presale_flag')?.checked;
            const useCash = document.getElementById('cash_flag')?.checked;
            const customDiscount = parseFloat(document.getElementById('custom_discount').value) || 0;

            const rows = Array.from(document.querySelectorAll('tr'))
                .filter(row => /^item_hidden_\d+$/.test(row.id));

            let updated = 0;  // 实际修改的商品数量
            let skipped = 0;  // 跳过的商品数量
            let processed = 0; // 已处理数量

            for (const row of rows) {
                processed++;
                progressText.textContent = `⏳ 正在处理第 ${processed}/${rows.length} 个商品...`;
                
                const productCode = row.querySelector('input[name^="product_model"]')?.value || '';
                
                // 修改描述文本的获取逻辑
                let descText = '';
                // 先尝试获取 input
                const descInput = row.querySelector('input[name^="product_description"]');
                // 如果没有 input，尝试获取 td 下的所有 a 标签
                const descLinks = row.querySelectorAll('td a');
                
                if (descInput) {
                    descText = descInput.value?.trim() || '';
                } else {
                    // 遍历所有找到的 a 标签，合并它们的文本内容
                    descLinks.forEach(link => {
                        descText += ' ' + (link.textContent?.trim() || '');
                    });
                    descText = descText.trim();
                }

                // 调试输出
                //console.log('商品描述文本:', descText);

                // 检查商品代码前缀
                const isSpecialPrefix = /^(BS|ITG|HI|FM|GU)/.test(productCode);
                const isForeign = productCode.startsWith('IT') || productCode.startsWith('ES');
                const isExcluded = descText.includes('特价');
                const isNoDiscount = descText.includes('无折扣');
                const isCrdSet = productCode.includes('CRDSET');
                
                // 跳过条件更新
                const skip = isExcluded || 
                           (isForeign && !useCash) || 
                           (isCrdSet && useAmount);

                // 尝试抓取折扣位置
                let amountCell, presaleCell, cashCell;

                const strictCells = Array.from(row.querySelectorAll('td'))
                    .filter(td => td.getAttribute('class') === 'text_right');

                if (strictCells.length >= 3) {
                    [amountCell, presaleCell, cashCell] = strictCells;
                } else {
                    amountCell = row.querySelector('input[name^="discount_percent_1"]');
                    presaleCell = row.querySelector('input[name^="discount_percent_2"]');
                    cashCell = row.querySelector('input[name^="discount_percent_3"]');
                }

                if (!amountCell || !presaleCell || !cashCell) {
                    console.warn(`⚠️ 跳过结构不完整商品行: ${row.id}`);
                    return;
                }

                if (skip) {
                    skipped++;
                    continue;
                }

                let hasUpdates = false;

                // 应用折扣值
                if (useAmount && !isCrdSet && !isSpecialPrefix && !isNoDiscount) {
                    const currentDiscount = getDiscountValue(amountCell);
                    if (currentDiscount === 0) {
                        await setDiscountValue(amountCell, customDiscount);
                        hasUpdates = true;
                    }
                }
                if (usePresale && !isSpecialPrefix && !isNoDiscount && !isForeign) {
                    const currentPresale = getDiscountValue(presaleCell);
                    if (currentPresale === 0) {
                        await setDiscountValue(presaleCell, 5);
                        hasUpdates = true;
                    }
                }
                if (useCash) {
                    const currentCash = getDiscountValue(cashCell);
                    if (currentCash === 0) {
                        let cashDiscountRate = 0;
                        if (isNoDiscount) {
                            cashDiscountRate = 3;
                        } else if (isSpecialPrefix) {
                            cashDiscountRate = 5;
                        } else if (isForeign) {
                            cashDiscountRate = 3;
                        } else {
                            cashDiscountRate = 5;
                        }
                        await setDiscountValue(cashCell, cashDiscountRate);
                        hasUpdates = true;
                    }
                }

                if (hasUpdates) {
                    updated++;
                    progressText.textContent = `⏳ 正在处理第 ${processed}/${rows.length} 个商品...已修改 ${updated} 个`;
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            }

            // 恢复按钮状态
            btn.disabled = false;
            btn.textContent = '应用折扣';
            progressText.textContent = `✅ 处理完成！`;

            // 更新上次处理结果
            updateLastResult(updated, skipped, rows.length);

            alert(`🎉 折扣应用完成：
- 实际修改：${updated} 个商品
- 跳过处理：${skipped} 个商品（特价/无折扣/IT/ES商品）
- 未修改：${rows.length - updated - skipped} 个商品（已有折扣）`);
            
            // 3秒后清除进度文本
            setTimeout(() => {
                progressText.textContent = '';
            }, 3000);
        });

        // 修改 setDiscountValue 函数
        function setDiscountValue(cell, value) {
            return new Promise((resolve) => {
                const val = parseFloat(value).toFixed(2);
                
                if (cell.tagName === 'INPUT') {
                    cell.value = val;
                    // 将请求添加到队列
                    requestQueue.push(async () => {
                        try {
                            const changeEvent = new Event('change', { bubbles: true });
                            cell.dispatchEvent(changeEvent);
                            
                            const inputEvent = new Event('input', { bubbles: true });
                            cell.dispatchEvent(inputEvent);
                            
                            const blurEvent = new FocusEvent('blur', { bubbles: true });
                            cell.dispatchEvent(blurEvent);
                            
                            // 等待一小段时间确保请求完成
                            await new Promise(r => setTimeout(r, 100));
                            resolve(true);
                        } catch (error) {
                            console.error('设置折扣失败:', error);
                            resolve(false);
                        }
                    });
                } else {
                    cell.textContent = val;
                    requestQueue.push(async () => {
                        try {
                            const clickEvent = new MouseEvent('click', {
                                bubbles: true,
                                cancelable: true,
                                view: window
                            });
                            cell.dispatchEvent(clickEvent);
                            await new Promise(r => setTimeout(r, 100));
                            resolve(true);
                        } catch (error) {
                            console.error('设置折扣失败:', error);
                            resolve(false);
                        }
                    });
                }
                
                // 触发队列处理
                processQueue();
            });
        }
    }

    function makeDraggable(el) {
        let isDragging = false, offsetX = 0, offsetY = 0;

        el.addEventListener('mousedown', function (e) {
            if (['INPUT', 'BUTTON', 'LABEL'].includes(e.target.tagName)) return;
            isDragging = true;
            offsetX = e.clientX - el.getBoundingClientRect().left;
            offsetY = e.clientY - el.getBoundingClientRect().top;
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', stop);
        });

        function move(e) {
            if (!isDragging) return;
            el.style.left = `${e.clientX - offsetX}px`;
            el.style.top = `${e.clientY - offsetY}px`;
        }

        function stop() {
            isDragging = false;
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', stop);
        }
    }

    // 新增获取折扣值的函数
    function getDiscountValue(cell) {
        if (cell.tagName === 'INPUT') {
            return parseFloat(cell.value) || 0;
        } else {
            return parseFloat(cell.textContent) || 0;
        }
    }
})();
