// ==UserScript==
// @name         折扣自动计算助手 v2.1.1 (Customizable)
// @copyright    2025, ZFT (https://github.com/ZFENGTING)
// @namespace    https://github.com/ZFENGTING
// @version      v2.1.20260922
// @description  支持普通页和变体页折扣结构，稳定处理所有商品行，支持自定义规则
// @match        http://ns71.bosonapp.com/boson/module/sale/sale_reg.php*
// @updateURL    https://raw.githubusercontent.com/ZFENGTING/tamper-scripts/master/discount-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/ZFENGTING/tamper-scripts/master/discount-helper.user.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
    'use strict';

    // --- Configuration Management ---
    const DEFAULT_CONFIG = {
        scanRules: [
            { id: 'special_prefix', name: '特殊前缀(BS/ITG等)', target: 'code', type: 'regex', value: '^(BS|ITG|HI|FM|GU)' },
            { id: 'foreign_prefix', name: '国外前缀(IT/ES)', target: 'code', type: 'startsWith', value: 'IT,ES' },
            { id: 'excluded_desc', name: '特价商品', target: 'desc', type: 'includes', value: '特价' },
            { id: 'no_discount_desc', name: '无折扣商品', target: 'desc', type: 'includes', value: '无折扣' },
            { id: 'crdset', name: 'CRDSET', target: 'code', type: 'includes', value: 'CRDSET' }
        ],
        amountDiscount: {
            skipRules: ['special_prefix', 'foreign_prefix', 'excluded_desc', 'no_discount_desc', 'crdset']
        },
        presaleDiscount: {
            rate: 5,
            skipRules: ['special_prefix', 'foreign_prefix', 'excluded_desc', 'no_discount_desc']
        },
        cashDiscount: {
            defaultRate: 5,
            skipRules: ['excluded_desc'],
            exceptions: [
                { ruleId: 'no_discount_desc', rate: 3 },
                { ruleId: 'special_prefix', rate: 5 },
                { ruleId: 'foreign_prefix', rate: 3 }
            ]
        }
    };

    const ConfigManager = {
        key: 'boson_discount_config_v2',
        get() {
            const saved = localStorage.getItem(this.key);
            if (!saved) return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
            try {
                // Merge with default to ensure new fields act sane if structure changes
                const parsed = JSON.parse(saved);
                return { ...DEFAULT_CONFIG, ...parsed };
            } catch (e) {
                console.error('Config load error', e);
                return DEFAULT_CONFIG;
            }
        },
        save(config) {
            localStorage.setItem(this.key, JSON.stringify(config));
        },
        reset() {
            localStorage.removeItem(this.key);
            return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        }
    };

    // --- Main Logic ---

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
            font-family: Arial, sans-serif;
        `;

        panel.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <span style="font-weight:bold;color:#333;">折扣助手</span>
                <button type="button" id="settings_btn" style="cursor:pointer;background:none;border:none;font-size:16px;">⚙️</button>
            </div>
            <div><b>💬 备注内容：</b><div style="white-space:pre-wrap;margin:4px 0 10px 0;">${remarkText}</div></div>
            <b>💰 订单金额：</b>${totalAmount.toFixed(2)} EUR，
            推荐折扣：<input type="number" id="custom_discount" value="${amountDiscount}" min="0" max="100" step="0.5" style="width:50px;text-align:right">%<br/><br/>
            <div id="last_result" style="margin-bottom:10px;font-size:12px;color:#666;"></div>
            <label><input type="checkbox" id="amount_flag" ${amountChecked}> 应用金额折扣 ${warningText}</label><br/>
            <label><input type="checkbox" id="presale_flag"> 应用预售订单折扣</label><br/>
            <label><input type="checkbox" id="cash_flag"> 应用现金支付折扣</label><br/><br/>
            <button type="button" id="apply_discount_btn" style="width:100%;padding:5px;background:#007bff;color:white;border:none;border-radius:4px;cursor:pointer;">应用折扣</button>
            <div id="progress_text" style="margin-top:8px;color:#666;font-size:13px;"></div>
        `;

        document.body.appendChild(panel);
        makeDraggable(panel);

        // Bind Settings Button
        document.getElementById('settings_btn').addEventListener('click', () => {
            SettingsUI.open();
        });

        document.getElementById('apply_discount_btn').addEventListener('click', async () => {
            await applyDiscounts();
        });
    }

    async function applyDiscounts() {
        const config = ConfigManager.get();
        const btn = document.getElementById('apply_discount_btn');
        const progressText = document.getElementById('progress_text');

        if (btn.disabled) return;

        const useAmount = document.getElementById('amount_flag')?.checked;
        const usePresale = document.getElementById('presale_flag')?.checked;
        const useCash = document.getElementById('cash_flag')?.checked;
        const customDiscount = Number(document.getElementById('custom_discount').value);

        const rows = Array.from(document.querySelectorAll('tr'))
            .filter(row => /^item_hidden_\d+$/.test(row.id));

        const selectedTypes = [
            useAmount && 'amount', usePresale && 'presale', useCash && 'cash'
        ].filter(Boolean);
        if (!selectedTypes.length) {
            progressText.textContent = '请先勾选要应用的折扣。';
            return;
        }
        if (!rows.length) {
            progressText.textContent = '未找到商品行，请等待商品加载完成。';
            return;
        }
        const rates = [
            ...(useAmount ? [customDiscount] : []),
            ...(usePresale ? [config.presaleDiscount.rate] : []),
            ...(useCash ? [config.cashDiscount.defaultRate, ...config.cashDiscount.exceptions.map(e => e.rate)] : [])
        ];
        if (rates.some(rate => !Number.isFinite(Number(rate)) || Number(rate) < 0 || Number(rate) > 100)) {
            progressText.textContent = '折扣必须是 0 到 100 之间的数字，请检查折扣配置。';
            return;
        }

        let updated = 0;
        let skipped = 0;
        let processed = 0;
        let failed = 0;
        let errorMessage = '';

        // Parse Logic
        const products = rows.map(row => {
            // Value from hidden input is most accurate; fallback to 3rd column text
            const productCode = row.querySelector('input[name^="product_model["]')?.value ||
                row.cells[2]?.innerText.trim() || '';

            let descText = '';
            const descInput = row.querySelector('input[name^="product_description["]');

            if (descInput) {
                descText = descInput.value?.trim() || '';
            } else {
                // Fallback: read text from 5th column (index 4) to avoid capturing model links
                const descCell = row.cells[4];
                if (descCell) {
                    descText = descCell.innerText.trim();
                }
            }

            // Match Config Rules
            const matchedRules = new Set();
            config.scanRules.forEach(rule => {
                const target = rule.target === 'code' ? productCode : descText;
                let isMatch = false;
                if (!rule.value) return; // skip empty rules
                try {
                    if (rule.type === 'regex') {
                        isMatch = new RegExp(rule.value).test(target);
                    } else if (rule.type === 'startsWith') {
                        const prefixes = rule.value.split(/[,，]/).map(s => s.trim()).filter(s => s);
                        isMatch = prefixes.some(p => target.startsWith(p));
                    } else if (rule.type === 'includes') {
                        isMatch = target.includes(rule.value);
                    }
                } catch (e) {
                    console.warn(`Rule error [${rule.name}]:`, e);
                }
                if (isMatch) matchedRules.add(rule.id);
            });

            return {
                row,
                matchedRules,
                cells: getDiscountInputs(row)
            };
        });

        if (products.some(p => selectedTypes.some(type => !isEditableDiscountInput(p.cells[type])))) {
            progressText.textContent = '部分商品缺少可编辑的折扣输入框，已停止。请确认单据未审核、商品已加载且有编辑权限。';
            return;
        }

        btn.disabled = true;
        btn.textContent = '处理中...';
        btn.style.background = '#ccc';

        try {
            // Priority: Amount -> Presale -> Cash

            // 1. Amount Discount
            if (useAmount) {
                progressText.textContent = '⏳ 正在处理金额折扣...';
                for (const p of products) {
                    // Check Skip
                    const shouldSkip = config.amountDiscount.skipRules.some(rId => p.matchedRules.has(rId));
                    if (shouldSkip || !p.cells.amount) {
                        skipped++;
                        continue;
                    }

                    const val = getDiscountValue(p.cells.amount);
                    if (val === 0 && customDiscount > 0) {
                        const success = await setDiscountValue(p.cells.amount, customDiscount);
                        if (success) updated++;
                        else failed++;
                    }
                    processed++;
                    progressText.textContent = `⏳ 金额折扣: ${processed}/${products.length}`;
                }
                await new Promise(r => setTimeout(r, 100));
            }

            // 2. Presale Discount
            if (usePresale) {
                processed = 0;
                progressText.textContent = '⏳ 正在处理预售折扣...';
                for (const p of products) {
                    const shouldSkip = config.presaleDiscount.skipRules.some(rId => p.matchedRules.has(rId));
                    if (shouldSkip || !p.cells.presale) continue;

                    const val = getDiscountValue(p.cells.presale);
                    if (val === 0 && Number(config.presaleDiscount.rate) > 0) {
                        const success = await setDiscountValue(p.cells.presale, config.presaleDiscount.rate);
                        if (success) updated++;
                        else failed++;
                    }
                    processed++;
                    progressText.textContent = `⏳ 预售折扣: ${processed}/${products.length}`;
                }
                await new Promise(r => setTimeout(r, 100));
            }

            // 3. Cash Discount
            if (useCash) {
                processed = 0;
                progressText.textContent = '⏳ 正在处理现金折扣...';
                for (const p of products) {
                    const shouldSkip = config.cashDiscount.skipRules.some(rId => p.matchedRules.has(rId));
                    if (shouldSkip || !p.cells.cash) continue;

                    const val = getDiscountValue(p.cells.cash);
                    if (val === 0) {
                        // Find rate
                        let rate = config.cashDiscount.defaultRate;
                        // Check exceptions in order
                        for (const exc of config.cashDiscount.exceptions) {
                            if (p.matchedRules.has(exc.ruleId)) {
                                rate = parseFloat(exc.rate);
                                break; // First match wins
                            }
                        }

                        if (Number(rate) === 0) continue;
                        const success = await setDiscountValue(p.cells.cash, rate);
                        if (success) updated++;
                        else failed++;
                    }
                    processed++;
                    progressText.textContent = `⏳ 现金折扣: ${processed}/${products.length}`;
                }
            }

        } catch (e) {
            console.error(e);
            errorMessage = e.message;
            alert('处理出错: ' + e.message);
        }

        btn.disabled = false;
        btn.textContent = '应用折扣';
        btn.style.background = '#007bff';
        progressText.textContent = errorMessage
            ? `处理已中断：${errorMessage}。已填写 ${updated} 项，请刷新核对。`
            : `已填写: ${updated}, 未写入: ${failed}, 跳过(金额): ${skipped}。已填写项已触发网站保存，请刷新核对结果。`;

        // Update result display
        const lastResult = document.getElementById('last_result');
        if (lastResult) {
            lastResult.textContent = `最近：已填写 ${updated} | 未写入 ${failed} | 跳过 ${skipped} | 总计 ${rows.length}`;
        }
    }

    // --- Settings UI ---

    const SettingsUI = {
        open() {
            if (document.getElementById('setting_modal')) return;
            const config = ConfigManager.get();

            const modal = document.createElement('div');
            modal.id = 'setting_modal';
            modal.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.5); z-index: 10000;
                display: flex; justify-content: center; align-items: center;
            `;

            const content = document.createElement('div');
            content.style.cssText = `
                background: white; width: 600px; max-height: 80vh; overflow-y: auto;
                border-radius: 8px; padding: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                font-family: system-ui, -apple-system, sans-serif;
            `;

            content.innerHTML = `
                <h2 style="margin-top:0;border-bottom:1px solid #eee;padding-bottom:10px;">规则设定</h2>
                
                <div style="margin-bottom:15px;">
                <div style="margin-bottom:15px;border-bottom:1px solid #eee;">
                    <button class="tab-btn active" data-tab="tab-rules" style="${tabStyle(true)}">1. 规则管理</button>
                    <button class="tab-btn" data-tab="tab-logic" style="${tabStyle(false)}">2. 折扣应用逻辑</button>
                </div>

                <div id="tab-rules" class="tab-content" style="display:block;">
                    <table style="width:100%;border-collapse:collapse;font-size:13px;">
                        <thead>
                            <tr style="background:#f5f5f5;text-align:left;">
                                <th style="padding:8px;">匹配目标</th>
                                <th style="padding:8px;">匹配方式</th>
                                <th style="padding:8px;">关键词</th>
                                <th style="padding:8px;width:50px;">操作</th>
                            </tr>
                        </thead>
                        <tbody id="rules_tbody"></tbody>
                    </table>
                    <button id="add_rule_btn" style="margin-top:10px;padding:5px 10px;cursor:pointer;background:#e9ecef;border:1px solid #ced4da;border-radius:4px;">+ 添加规则</button>
                    <div style="margin-top:10px;font-size:12px;color:#888;">提示：配置完成后，切换到「折扣逻辑配置」勾选生效。</div>
                </div>

                <div id="tab-logic" class="tab-content" style="display:none;">
                    
                    <div class="logic-block" style="border:1px solid #eee;padding:10px;margin-bottom:10px;border-radius:4px;">
                        <h3 style="margin:0 0 10px 0;font-size:15px;">💰 金额折扣</h3>
                        <div>
                            <span>🚫 满足以下任一规则时<b>跳过</b>：</span><br/>
                            <div id="amount_skip_container" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:5px;"></div>
                        </div>
                    </div>

                    <div class="logic-block" style="border:1px solid #eee;padding:10px;margin-bottom:10px;border-radius:4px;">
                        <h3 style="margin:0 0 10px 0;font-size:15px;">🔖 预售折扣</h3>
                        <div style="margin-bottom:5px;">固定折扣率：<input type="number" id="presale_rate" style="width:50px" value="${config.presaleDiscount.rate}">%</div>
                        <div>
                            <span>🚫 满足以下任一规则时<b>跳过</b>：</span><br/>
                            <div id="presale_skip_container" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:5px;"></div>
                        </div>
                    </div>

                    <div class="logic-block" style="border:1px solid #eee;padding:10px;margin-bottom:10px;border-radius:4px;">
                        <h3 style="margin:0 0 10px 0;font-size:15px;">💵 现金折扣</h3>
                         <div style="margin-bottom:5px;">默认折扣率：<input type="number" id="cash_default_rate" style="width:50px" value="${config.cashDiscount.defaultRate}">%</div>
                        <div style="margin-bottom:10px;">
                            <span>🚫 满足以下任一规则时<b>跳过</b>：</span><br/>
                            <div id="cash_skip_container" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:5px;"></div>
                        </div>
                        <div>
                            <span>⚡ 特殊规则 (优先匹配):</span>
                            <table style="width:100%;font-size:13px;margin-top:5px;">
                                <tbody id="cash_exc_tbody"></tbody>
                            </table>
                            <button id="add_exc_btn" style="margin-top:5px;font-size:12px;">+ 添加特殊规则</button>
                        </div>
                    </div>

                </div>

                <div style="margin-top:20px;display:flex;justify-content:flex-end;gap:10px;border-top:1px solid #eee;padding-top:10px;">
                    <button id="reset_btn" style="padding:6px 14px;background:#6c757d;color:white;border:none;border-radius:4px;cursor:pointer;">重置默认</button>
                    <button id="close_btn" style="padding:6px 14px;background:#eee;border:none;border-radius:4px;cursor:pointer;">取消</button>
                    <button id="save_btn" style="padding:6px 14px;background:#28a745;color:white;border:none;border-radius:4px;cursor:pointer;">保存配置</button>
                </div>
            `;

            modal.appendChild(content);
            document.body.appendChild(modal);

            // Logic Helpers
            const renderRules = () => {
                const tbody = document.getElementById('rules_tbody');
                tbody.innerHTML = '';
                config.scanRules.forEach((rule, idx) => {
                    createRuleRow(rule);
                });
            };

            const createRuleRow = (rule = null) => {
                const tbody = document.getElementById('rules_tbody');
                const tr = document.createElement('tr');
                // Auto-generate ID if new
                const ruleId = rule ? rule.id : ('rule_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5));
                const target = rule ? rule.target : 'code';
                const type = rule ? rule.type : 'includes';
                const val = rule ? rule.value : '';

                tr.dataset.id = ruleId;
                tr.style.borderBottom = '1px solid #eee';

                tr.innerHTML = `
                    <td style="padding:8px;">
                        <select class="rule-target" style="width:100%;padding:4px;">
                            <option value="code" ${target === 'code' ? 'selected' : ''}>型号</option>
                            <option value="desc" ${target === 'desc' ? 'selected' : ''}>品名</option>
                        </select>
                    </td>
                    <td style="padding:8px;">
                        <select class="rule-type" style="width:100%;padding:4px;">
                            <option value="includes" ${type === 'includes' ? 'selected' : ''}>包含</option>
                            <option value="startsWith" ${type === 'startsWith' ? 'selected' : ''}>开头是</option>
                            <option value="regex" ${type === 'regex' ? 'selected' : ''}>正则(高级)</option>
                        </select>
                    </td>
                    <td style="padding:8px;"><input type="text" class="rule-value" value="${val}" style="width:100%;padding:4px;border:1px solid #ddd;border-radius:3px;" placeholder="输入关键词..."></td>
                    <td style="padding:8px;"><button onclick="this.closest('tr').remove()" style="color:#dc3545;background:none;border:none;cursor:pointer;font-size:16px;">&times;</button></td>
                `;
                tbody.appendChild(tr);
            };

            const renderCheckboxes = (containerId, selectedList) => {
                const container = document.getElementById(containerId);
                container.innerHTML = '';
                // Get all current rules from DOM if possible, or config
                // Better to use current config + any added rows. 
                // For simplicity, we use the config.scanRules ref (assuming users save rules first or we parse DOM).
                // Let's parse DOM rules to be dynamic.
                const rules = getRulesFromDOM();
                rules.forEach(r => {
                    const label = document.createElement('label');
                    label.style.cssText = 'font-size:12px;display:flex;align-items:center;background:#f8f9fa;padding:2px 6px;border-radius:3px;border:1px solid #ddd;';
                    const checked = selectedList.includes(r.id) ? 'checked' : '';
                    label.innerHTML = `<input type="checkbox" value="${r.id}" ${checked} style="margin-right:4px;"> ${r.name}`;
                    container.appendChild(label);
                });
            };

            const renderCashExc = () => {
                const tbody = document.getElementById('cash_exc_tbody');
                tbody.innerHTML = '';
                const rules = getRulesFromDOM();
                config.cashDiscount.exceptions.forEach(exc => {
                    const tr = document.createElement('tr');
                    // Filter out deleted rules to avoid bugs, or show invalid
                    const matchingRule = rules.find(r => r.id === exc.ruleId);
                    const ruleName = matchingRule ? matchingRule.name : '(已删除规则)';

                    let options = rules.map(r => `<option value="${r.id}" ${r.id === exc.ruleId ? 'selected' : ''}>${r.name}</option>`).join('');
                    tr.innerHTML = `
                        <td style="width:60%">当 <select style="width:150px;max-width:200px;">${options}</select></td>
                        <td>折扣 <input type="number" value="${exc.rate}" style="width:50px">%</td>
                        <td><button onclick="this.closest('tr').remove()" style="color:red;background:none;border:none;cursor:pointer;">×</button></td>
                    `;
                    tbody.appendChild(tr);
                });
            };

            const getRulesFromDOM = () => {
                const rows = Array.from(document.querySelectorAll('#rules_tbody tr'));
                return rows.map(r => {
                    const targetSelect = r.querySelector('.rule-target');
                    const typeSelect = r.querySelector('.rule-type');
                    const valueInput = r.querySelector('.rule-value');

                    const id = r.dataset.id;
                    const target = targetSelect.value;
                    const type = typeSelect.value;
                    const value = valueInput.value.trim();

                    // Auto-generate a readable name for Logic Tab
                    const targetName = target === 'code' ? '型号' : '品名';
                    const typeName = type === 'includes' ? '包含' : (type === 'startsWith' ? '开头是' : '正则');
                    const name = `[${targetName}] ${typeName} "${value}"`;

                    return { id, name, target, type, value };
                });
            };

            // Interactions
            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.onclick = () => {
                    document.querySelectorAll('.tab-btn').forEach(b => {
                        b.classList.remove('active');
                        b.style.borderBottom = 'none';
                        b.style.fontWeight = 'normal';
                    });
                    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
                    btn.classList.add('active');
                    btn.style.borderBottom = '2px solid #007bff';
                    btn.style.fontWeight = 'bold';
                    document.getElementById(btn.dataset.tab).style.display = 'block';

                    if (btn.dataset.tab === 'tab-logic') {
                        // Refresh logic checkboxes based on current rules
                        renderCheckboxes('amount_skip_container', config.amountDiscount.skipRules);
                        renderCheckboxes('presale_skip_container', config.presaleDiscount.skipRules);
                        renderCheckboxes('cash_skip_container', config.cashDiscount.skipRules);
                        renderCashExc();
                    }
                };
            });

            document.getElementById('add_rule_btn').onclick = () => {
                createRuleRow();
            };

            document.getElementById('add_exc_btn').onclick = () => {
                const tbody = document.getElementById('cash_exc_tbody');
                const rules = getRulesFromDOM();
                const tr = document.createElement('tr');
                let options = rules.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
                tr.innerHTML = `
                    <td style="width:50%">匹配 <select style="width:120px">${options}</select></td>
                    <td>折扣 <input type="number" value="5" style="width:50px">%</td>
                    <td><button onclick="this.parentElement.parentElement.remove()" style="color:red;cursor:pointer;">×</button></td>
                `;
                tbody.appendChild(tr);
            };

            document.getElementById('save_btn').onclick = () => {
                // Collect Data
                // Use a little hack to access DOM inside the function
                const newRules = getRulesFromDOM();

                // Helper to get checked values inside the correct container
                const getChecked = (id) => {
                    const container = document.getElementById(id);
                    if (!container) return [];
                    return Array.from(container.querySelectorAll('input:checked')).map(cb => cb.value);
                };

                const newConfig = {
                    scanRules: newRules,
                    amountDiscount: { skipRules: getChecked('amount_skip_container') },
                    presaleDiscount: {
                        rate: parseFloat(document.getElementById('presale_rate').value) || 0,
                        skipRules: getChecked('presale_skip_container')
                    },
                    cashDiscount: {
                        defaultRate: parseFloat(document.getElementById('cash_default_rate').value) || 0,
                        skipRules: getChecked('cash_skip_container'),
                        exceptions: Array.from(document.querySelectorAll('#cash_exc_tbody tr')).map(tr => ({
                            ruleId: tr.querySelector('select').value,
                            rate: parseFloat(tr.querySelector('input').value)
                        }))
                    }
                };

                ConfigManager.save(newConfig);
                alert('配置已保存 (Please reload page if necessary)');
                modal.remove();
            };

            document.getElementById('close_btn').onclick = () => modal.remove();
            document.getElementById('reset_btn').onclick = () => {
                if (confirm('确定重置为默认配置吗？')) {
                    ConfigManager.reset();
                    alert('已重置');
                    modal.remove();
                    SettingsUI.open();
                }
            };

            // Init
            renderRules();
            document.querySelector('.tab-btn.active').click(); // Trigger render of checkboxes
        }
    };

    function tabStyle(active) {
        return active ? 'border:none;background:white;border-bottom:2px solid #007bff;padding:8px 16px;font-weight:bold;cursor:pointer;' : 'border:none;background:transparent;padding:8px 16px;cursor:pointer;';
    }


    // --- Core Helpers (Queue & Set Value) ---

    let requestQueue = [];
    let isProcessing = false;

    function getDiscountInputs(row) {
        // Field names remain stable when price columns move or share CSS classes.
        return {
            amount: row.querySelector('input[name^="discount_percent_1["]'),
            presale: row.querySelector('input[name^="discount_percent_2["]'),
            cash: row.querySelector('input[name^="discount_percent_3["]')
        };
    }

    function isEditableDiscountInput(input) {
        return !!input && input.tagName === 'INPUT' &&
            /^discount_percent_[123]\[\d+\]$/.test(input.name) &&
            ['text', 'number'].includes(input.type) &&
            !input.disabled && !input.readOnly && !input.matches(':disabled') && input.isConnected;
    }

    // Process helper
    async function processQueue() {
        if (isProcessing || requestQueue.length === 0) return;
        isProcessing = true;
        const batch = requestQueue.splice(0, 1);
        try {
            await batch[0]();
            await new Promise(r => setTimeout(r, 10));
        } finally {
            isProcessing = false;
            if (requestQueue.length > 0) processQueue();
        }
    }

    function setDiscountValue(cell, value) {
        const rate = Number(value);
        if (!Number.isFinite(rate) || rate < 0 || rate > 100) return Promise.resolve(false);
        return new Promise((resolve) => {
            const val = rate.toFixed(2);
            requestQueue.push(async () => {
                let success = false;
                try {
                    if (isEditableDiscountInput(cell) && getDiscountValue(cell) === 0 && rate > 0) {
                        cell.value = val;
                        // Boson saves and recalculates on input; never rewrite a display cell.
                        cell.dispatchEvent(new Event('input', { bubbles: true }));
                        await new Promise(r => setTimeout(r, 200));
                        if (cell.isConnected && Number(cell.value) === rate) success = true;
                    }
                } catch (e) { console.error(e); }
                resolve(success);
            });
            processQueue();
        });
    }

    function getDiscountValue(cell) {
        return isEditableDiscountInput(cell) ? Number(cell.value.trim()) : NaN;
    }

    function makeDraggable(el) {
        let isDragging = false, offsetX = 0, offsetY = 0;
        const header = document.createElement('div');
        // We make the whole panel draggable but ignore inputs
        el.addEventListener('mousedown', function (e) {
            if (['INPUT', 'BUTTON', 'LABEL', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
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

})();
