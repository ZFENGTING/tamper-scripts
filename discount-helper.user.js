// ==UserScript==
// @name         折扣自动计算助手 v2.0.20250408
// @copyright    2025, ZFT (https://github.com/ZFENGTING)
// @namespace    https://github.com/ZFENGTING
// @version      v2.0.20250408
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

            // 获取所有需要处理的商品信息
            const products = rows.map(row => {
                const productCode = row.querySelector('input[name^="product_model"]')?.value || '';
                
                let descText = '';
                const descInput = row.querySelector('input[name^="product_description"]');
                const descLinks = row.querySelectorAll('td a');
                
                if (descInput) {
                    descText = descInput.value?.trim() || '';
                } else {
                    descLinks.forEach(link => {
                        descText += ' ' + (link.textContent?.trim() || '');
                    });
                    descText = descText.trim();
                }

                const isSpecialPrefix = /^(BS|ITG|HI|FM|GU)/.test(productCode);
                const isForeign = productCode.startsWith('IT') || productCode.startsWith('ES');
                const isExcluded = descText.includes('特价');
                const isNoDiscount = descText.includes('无折扣');
                const isCrdSet = productCode.includes('CRDSET');

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

                return {
                    row,
                    productCode,
                    isSpecialPrefix,
                    isForeign,
                    isExcluded,
                    isNoDiscount,
                    isCrdSet,
                    cells: {
                        amount: amountCell,
                        presale: presaleCell,
                        cash: cashCell
                    },
                    skip: isExcluded || (isForeign && !useCash) || (isCrdSet && useAmount)
                };
            });

            try {
                // 1. 处理所有商品的金额折扣
                if (useAmount) {
                    progressText.textContent = '⏳ 正在处理金额折扣...';
                    for (const product of products) {
                        if (product.skip || !product.cells.amount || product.isCrdSet || 
                            product.isSpecialPrefix || product.isNoDiscount || product.isForeign) {
                            continue;
                        }
                        
                        const currentDiscount = getDiscountValue(product.cells.amount);
                        if (currentDiscount === 0) {
                            const success = await setDiscountValue(product.cells.amount, customDiscount);
                            if (success) {
                                updated++;
                                console.log(`✅ 金额折扣应用成功: ${product.row.id}`);
                            }
                        }
                        processed++;
                        progressText.textContent = `⏳ 金额折扣处理进度: ${processed}/${products.length}`;
                    }
                    // 等待所有金额折扣处理完成
                    await new Promise(r => setTimeout(r, 100));
                }

                // 2. 处理所有商品的预售折扣
                if (usePresale) {
                    processed = 0;
                    progressText.textContent = '⏳ 正在处理预售折扣...';
                    for (const product of products) {
                        if (product.skip || !product.cells.presale || 
                            product.isSpecialPrefix || product.isNoDiscount || product.isForeign) {
                            continue;
                        }
                        
                        const currentPresale = getDiscountValue(product.cells.presale);
                        if (currentPresale === 0) {
                            const success = await setDiscountValue(product.cells.presale, 5);
                            if (success) {
                                updated++;
                                console.log(`✅ 预售折扣应用成功: ${product.row.id}`);
                            }
                        }
                        processed++;
                        progressText.textContent = `⏳ 预售折扣处理进度: ${processed}/${products.length}`;
                    }
                    // 等待所有预售折扣处理完成
                    await new Promise(r => setTimeout(r, 100));
                }

                // 3. 处理所有商品的现金折扣
                if (useCash) {
                    processed = 0;
                    progressText.textContent = '⏳ 正在处理现金折扣...';
                    for (const product of products) {
                        if (product.skip || !product.cells.cash) {
                            continue;
                        }
                        
                        const currentCash = getDiscountValue(product.cells.cash);
                        if (currentCash === 0) {
                            let cashDiscountRate = 0;
                            if (product.isNoDiscount) {
                                cashDiscountRate = 3;
                            } else if (product.isSpecialPrefix) {
                                cashDiscountRate = 5;
                            } else if (product.isForeign) {
                                cashDiscountRate = 3;
                            } else {
                                cashDiscountRate = 5;
                            }
                            
                            const success = await setDiscountValue(product.cells.cash, cashDiscountRate);
                            if (success) {
                                updated++;
                                console.log(`✅ 现金折扣应用成功: ${product.row.id}`);
                            }
                        }
                        processed++;
                        progressText.textContent = `⏳ 现金折扣处理进度: ${processed}/${products.length}`;
                    }
                }

            } catch (error) {
                console.error('❌ 处理折扣时发生错误:', error);
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
                let retryCount = 0;
                const maxRetries = 3;
                
                const trySetValue = async () => {
                    try {
                        if (cell.tagName === 'INPUT') {
                            cell.value = val;
                            
                            // 触发所有必要的事件
                            const events = ['focus', 'input', 'change', 'blur'];
                            for (const eventType of events) {
                                const event = new Event(eventType, { bubbles: true });
                                cell.dispatchEvent(event);
                            }
                            
                            // 等待更长时间确保请求完成
                            await new Promise(r => setTimeout(r, 200));
                            
                            // 验证值是否被正确设置
                            if (cell.value === val) {
                                resolve(true);
                            } else {
                                throw new Error('Value not set correctly');
                            }
                        } else {
                            cell.textContent = val;
                            
                            // 触发点击事件
                            const clickEvent = new MouseEvent('click', {
                                bubbles: true,
                                cancelable: true,
                                view: window
                            });
                            cell.dispatchEvent(clickEvent);
                            
                            // 等待更长时间确保请求完成
                            await new Promise(r => setTimeout(r, 200));
                            
                            // 验证值是否被正确设置
                            if (cell.textContent === val) {
                                resolve(true);
                            } else {
                                throw new Error('Value not set correctly');
                            }
                        }
                    } catch (error) {
                        console.error(`设置折扣失败 (尝试 ${retryCount + 1}/${maxRetries}):`, error);
                        retryCount++;
                        
                        if (retryCount < maxRetries) {
                            // 等待一段时间后重试
                            setTimeout(trySetValue, 100);
                        } else {
                            console.error('设置折扣失败，已达到最大重试次数');
                            resolve(false);
                        }
                    }
                };
                
                // 将请求添加到队列
                requestQueue.push(trySetValue);
                
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

