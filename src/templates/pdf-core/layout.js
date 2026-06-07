const { PDF_CORE } = require('./constants');
const { TYPE_SCALE } = require('./typography');

function renderLayoutCss(density = 'normal') {
  const scale = TYPE_SCALE[density] || TYPE_SCALE.normal;
  return `@page { size: A4 portrait; margin: 6mm; }
  *{box-sizing:border-box;} body{margin:0;font-family:Arial,sans-serif;font-size:${scale.body};color:#111;} .page{width:100%;display:flex;flex-direction:column;}
  .qms-a4-page{width:198mm;min-height:285mm;max-height:285mm;overflow:hidden;box-sizing:border-box;display:flex;flex-direction:column;padding:0;margin:0 auto;page-break-after:avoid;}
  table{width:100%;border-collapse:collapse;table-layout:fixed;} td,th{border:1px solid #222;padding:3px 4px;vertical-align:top;line-height:${scale.lineHeight};word-break:break-word;}
  th{background:#e4ebf5;font-weight:700;}
  .no-break{break-inside:avoid;page-break-inside:avoid;} .allow-break{break-inside:auto;} .overflow-safe{overflow-wrap:anywhere;} .spacer{flex:1;}`;
}

module.exports = { renderLayoutCss };
