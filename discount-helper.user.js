// ==UserScript==
// @name         tampermonkey折扣自动计算助手 v1.7
// @namespace    https://github.com/ZFENGTING
// @version      1.7
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
            <label><input type="checkbox" id="amount_flag" ${amountChecked}> 应用金额折扣${warningText}</label><br/>
            <label><input type="checkbox" id="presale_flag"> 应用预售订单折扣</label><br/>
            <label><input type="checkbox" id="cash_flag"> 应用现金支付折扣</label><br/><br/>
            <button id="apply_discount_btn">应用折扣</button>
        `;

        document.body.appendChild(panel);
        makeDraggable(panel);

        document.getElementById('apply_discount_btn').addEventListener('click', () => {
            const useAmount = document.getElementById('amount_flag')?.checked;
            const usePresale = document.getElementById('presale_flag')?.checked;
            const useCash = document.getElementById('cash_flag')?.checked;
            const customDiscount = parseFloat(document.getElementById('custom_discount').value) || 0;

            const rows = Array.from(document.querySelectorAll('tr'))
                .filter(row => /^item_hidden_\d+$/.test(row.id));

            let updated = 0;  // 实际修改的商品数量
            let skipped = 0;  // 跳过的商品数量

            rows.forEach((row) => {
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
                console.log('商品描述文本:', descText);

                const isForeign = productCode.startsWith('IT') || productCode.startsWith('ES');
                const isExcluded = descText.includes('特价') || descText.includes('无折扣');
                const isCrdSet = productCode.includes('CRDSET');
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
                    return;
                }

                let rowUpdated = false; // 标记该行是否有修改

                // 应用折扣值
                if (useAmount && !isCrdSet) {
                    const currentDiscount = getDiscountValue(amountCell);
                    if (currentDiscount === 0) {
                        setDiscountValue(amountCell, customDiscount);
                        rowUpdated = true;
                    }
                }
                if (usePresale) {
                    const currentPresale = getDiscountValue(presaleCell);
                    if (currentPresale === 0) {
                        setDiscountValue(presaleCell, 5);
                        rowUpdated = true;
                    }
                }
                if (useCash) {
                    const currentCash = getDiscountValue(cashCell);
                    if (currentCash === 0) {
                        const cashDiscountRate = isForeign ? 3 : 5;
                        setDiscountValue(cashCell, cashDiscountRate);
                        rowUpdated = true;
                    }
                }

                // 只有实际发生修改才计数
                if (rowUpdated) {
                    updated++;
                }
            });

            alert(`🎉 折扣应用完成：
- 实际修改：${updated} 个商品
- 跳过处理：${skipped} 个商品（特价/无折扣/IT/ES商品）
- 未修改：${rows.length - updated - skipped} 个商品（已有折扣）`);
        });
    }

    function setDiscountValue(cell, value) {
        const val = parseFloat(value).toFixed(2);
        if (cell.tagName === 'INPUT') {
            cell.value = val;
            // 触发 change 事件
            const changeEvent = new Event('change', { bubbles: true });
            cell.dispatchEvent(changeEvent);
            
            // 触发 input 事件
            const inputEvent = new Event('input', { bubbles: true });
            cell.dispatchEvent(inputEvent);
            
            // 触发 blur 事件（失去焦点时通常会触发提交）
            const blurEvent = new FocusEvent('blur', { bubbles: true });
            cell.dispatchEvent(blurEvent);
        } else {
            cell.textContent = val;
            // 如果是td元素，触发点击事件
            const clickEvent = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window
            });
            cell.dispatchEvent(clickEvent);
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
