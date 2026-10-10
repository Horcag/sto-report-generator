import { FigureSettings } from '@/shared/lib/figures';

import type { InspectedFigure } from './figure-inspector';

/** Data is JSON escaped; labels enter the document only through textContent. */
export function renderFigureInspector(
	figures: InspectedFigure[],
	settings: FigureSettings,
): string {
	const data = JSON.stringify({ figures, settings })
		.replace(/</g, '\\u003c')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');
	return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'">
<title>Настройка рисунков отчёта</title><style>
body{font:16px system-ui;margin:24px;color:#17202a;background:#f5f6f8}h1{font-size:24px}label{display:block;margin:12px 0}input{width:90px}select{max-width:100%;padding:8px}button{padding:10px}main{display:grid;grid-template-columns:300px 1fr;gap:24px}aside,section{background:white;padding:20px;border-radius:8px}.views{display:flex;gap:20px;flex-wrap:wrap}.view{width:420px;max-width:100%}.view>img{max-width:min(100%,360px);max-height:300px}.crop{position:relative;overflow:hidden;background:#eee}.crop img{position:absolute;max-width:none}.page{width:420px;aspect-ratio:210/297;box-sizing:border-box;background:white;border:1px solid #aaa;position:relative;overflow:hidden;max-width:100%}.page .crop{position:absolute;left:14.2857%;top:6.734%}.page::after{content:'A4: поля и расположение условные';position:absolute;bottom:10px;left:10px;font-size:12px;color:#666}pre{white-space:pre-wrap;font:14px system-ui}.warning{color:#9c3d00}@media(max-width:700px){main{display:block}.page{transform-origin:top left}}
</style></head><body><h1>Рисунки отчёта: исходник, обрезка и размер</h1>
<p>Изображения встроены в этот файл. Изменения действуют в просмотре; для сборки сохраните figures.json в каталог исходников отчёта. Номинальный лист не подтверждает вёрстку Word.</p>
<main><aside><label>Рисунок <select id="selection"></select></label><p id="caption"></p>
<label>Ширина, мм <input id="widthMm" type="number" min="1" step="1"></label>
<label>Предел высоты, мм <input id="maxHeightMm" type="number" min="1" step="1"></label>
<fieldset><legend>Обрезка исходника, %</legend>
<label>Слева <input id="left" type="number" min="0" max="99" step="1"></label><label>Справа <input id="right" type="number" min="0" max="99" step="1"></label>
<label>Сверху <input id="top" type="number" min="0" max="99" step="1"></label><label>Снизу <input id="bottom" type="number" min="0" max="99" step="1"></label></fieldset>
<label>Минимальный текст в исходнике, px <input id="textSizePx" type="number" min="0.01" step="0.1" placeholder="неизвестно"></label>
<button id="download">Скачать figures.json</button><p>Одна запись ID применяется ко всем соответствующим вхождениям. Текстовый размер укажите после измерения исходника; DPI не определяет читаемость.</p>
</aside><section><pre id="diagnostics" aria-live="polite"></pre><div class="views">
<div class="view"><h2>Исходник</h2><img id="original" alt="Исходное изображение"></div>
<div class="view"><h2>После обрезки</h2><div id="cropped" class="crop"><img alt="Область после обрезки"></div></div>
<div class="view"><h2>На листе, условный масштаб</h2><div class="page"><div id="placed" class="crop"><img alt="Рисунок на условном листе"></div></div></div>
</div><p>Обрезка скрывает содержимое по краям: проверьте подписи, оси, стрелки и легенду. Исходный файл остаётся целым.</p></section></main>
<script id="figure-data" type="application/json">${data}</script><script>
'use strict';
const model=JSON.parse(document.getElementById('figure-data').textContent);
const el=id=>document.getElementById(id), fields=['widthMm','maxHeightMm','left','right','top','bottom','textSizePx'];
const defaults=Object.assign({maxWidthMm:140,maxHeightMm:230,minDpi:150,minTextPt:9,quality:'warn'},model.settings.defaults);
let current, valid=true;
model.figures.forEach((f,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=f.occurrence+'. '+f.plan.id+' — '+f.module;el('selection').append(option);});
function view(id,f,c,w,h){const node=el(id),img=node.querySelector('img');node.style.width=w+'px';node.style.height=h+'px';img.src=f.dataUri;img.style.width=(w/(1-(c.left+c.right)/100))+'px';img.style.height=(h/(1-(c.top+c.bottom)/100))+'px';img.style.left=(-w*c.left/(100-c.left-c.right))+'px';img.style.top=(-h*c.top/(100-c.top-c.bottom))+'px';}
function select(){current=model.figures[Number(el('selection').value)];if(!current)return;const p=current.plan,s=model.settings.figures[p.id]||{};el('caption').textContent=current.caption||'Без подписи: '+p.asset;el('widthMm').value=s.widthMm||p.widthMm;el('maxHeightMm').value=s.maxHeightMm||defaults.maxHeightMm;['left','right','top','bottom'].forEach(k=>el(k).value=(s.crop||p.crop)[k]);el('textSizePx').value=s.textSizePx||'';el('textSizePx').disabled=p.type==='svg';el('original').src=current.dataUri;refresh(false);}
function refresh(save=true){if(!current)return;const p=current.plan,c={};['left','right','top','bottom'].forEach(k=>c[k]=Number(el(k).value));let w=Number(el('widthMm').value),limit=Number(el('maxHeightMm').value),text=el('textSizePx').value===''?undefined:Number(el('textSizePx').value);
valid=Number.isFinite(w)&&w>0&&Number.isFinite(limit)&&limit>0&&Object.values(c).every(v=>Number.isFinite(v)&&v>=0&&v<=100)&&c.left+c.right<100&&c.top+c.bottom<100&&(text===undefined||Number.isFinite(text)&&text>0);
el('download').disabled=!valid;if(!valid){el('diagnostics').textContent='Недопустимая геометрия: размеры должны быть положительными, обрезка должна сохранять область.';return;}
const cw=p.intrinsicPx.width*(1-(c.left+c.right)/100),ch=p.intrinsicPx.height*(1-(c.top+c.bottom)/100);const h=w*ch/cw;limit=Math.min(limit,defaults.maxHeightMm);if(w>defaults.maxWidthMm||h>limit){valid=false;el('download').disabled=true;el('diagnostics').textContent='Ширина или высота превышает пределы: уменьшите ширину или обрезку.';return;}
const dpiX=p.effectiveDpi.x*p.widthMm/w*(1-(c.left+c.right)/100)/(1-(p.crop.left+p.crop.right)/100),dpiY=p.effectiveDpi.y*p.heightMm/h*(1-(c.top+c.bottom)/100)/(1-(p.crop.top+p.crop.bottom)/100);const inferred=p.minTextPt===undefined?undefined:p.minTextPt*25.4/72*(p.intrinsicPx.width*(1-(p.crop.left+p.crop.right)/100))/p.widthMm;const font=p.type==='svg'?inferred:text,pt=font===undefined?undefined:font*w/cw*72/25.4;
const warnings=[];if(Math.min(dpiX,dpiY)<defaults.minDpi)warnings.push('Плотность ниже '+defaults.minDpi+' DPI');if(pt!==undefined&&pt<defaults.minTextPt)warnings.push('Текст меньше '+defaults.minTextPt+' pt');if(Object.values(c).some(v=>v>0))warnings.push('Обрезка: требуется визуальная проверка краёв');if(Number(el('widthMm').value)>defaults.maxWidthMm||w*ch/cw>=limit)warnings.push('Размер ограничен пределами страницы');
el('diagnostics').textContent='ID: '+p.id+' | исходник: '+p.asset+'\\n'+p.intrinsicPx.width+' × '+p.intrinsicPx.height+' px | '+w.toFixed(1)+' × '+h.toFixed(1)+' мм\\n'+(p.type==='svg'?'SVG: векторный исходник; DPI резервного PNG: '+dpiX.toFixed(0)+'':dpiX.toFixed(0)+' × '+dpiY.toFixed(0)+' DPI')+'\\nМинимальный текст: '+(pt===undefined?'неизвестно (не измерен)':pt.toFixed(1)+' pt '+(p.type==='svg'?'(из SVG)':'(по введённому размеру)'))+'\\n'+warnings.join('\\n');el('diagnostics').className=warnings.length?'warning':'';
const scale=Math.min(360/cw,300/ch,Math.max(1,el('cropped').parentElement.clientWidth)/cw);view('cropped',current,c,cw*scale,ch*scale);const pageScale=el('placed').parentElement.clientWidth/210;view('placed',current,c,w*pageScale,h*pageScale);
if(save){const spec=Object.assign({},model.settings.figures[p.id]||{},{widthMm:Number(el('widthMm').value),maxHeightMm:limit,crop:c});if(text===undefined)delete spec.textSizePx;else spec.textSizePx=text;model.settings.figures[p.id]=spec;}}
window.addEventListener('resize',()=>refresh(false));fields.forEach(id=>el(id).addEventListener('input',()=>refresh()));el('selection').addEventListener('change',select);
el('download').addEventListener('click',()=>{if(!valid)return;const url=URL.createObjectURL(new Blob([JSON.stringify(model.settings,null,2)+'\\n'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='figures.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
if(model.figures.length)select();else{el('diagnostics').textContent='В Markdown отчёта нет рисунков.';el('download').disabled=true;}
</script></body></html>`;
}
