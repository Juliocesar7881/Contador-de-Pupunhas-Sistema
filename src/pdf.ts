import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { imageDataUri } from './roboflow';
import type { Load, Pallet } from './types';

function escapeHtml(value: string | null | undefined) {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function buildPdfHtml(load: Load, pallets: Pallet[]) {
  const rows = pallets
    .map((pallet) => {
      const name = escapeHtml(pallet.name || `Palete ${pallet.pallet_number}`);

      return `
        <tr>
          <td>${name}</td>
          <td>${pallet.ai_count}</td>
          <td>${pallet.manual_count ?? '-'}</td>
          <td><strong>${pallet.final_count}</strong></td>
        </tr>
      `;
    })
    .join('');

  const thumbnails = pallets
    .map((pallet) => {
      const image = imageDataUri(pallet.ai_image_base64 ?? pallet.original_image_base64);
      const name = escapeHtml(pallet.name || `Palete ${pallet.pallet_number}`);

      return `
        <div class="thumb">
          <img src="${image}" />
          <div>${name} - ${pallet.final_count}</div>
        </div>
      `;
    })
    .join('');

  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8" />
        <style>
          @page { size: A4 portrait; margin: 18px; }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            color: #1f2933;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 10px;
          }
          header {
            border-bottom: 2px solid #147a5c;
            display: flex;
            justify-content: space-between;
            padding-bottom: 10px;
          }
          h1 {
            font-size: 20px;
            margin: 0 0 4px;
          }
          .muted { color: #687469; }
          .total {
            background: #ddeee5;
            border-radius: 8px;
            min-width: 120px;
            padding: 10px;
            text-align: right;
          }
          .total strong {
            color: #0e5c46;
            display: block;
            font-size: 28px;
            line-height: 30px;
          }
          .note {
            color: #687469;
            margin: 8px 0 10px;
          }
          .layout {
            display: grid;
            gap: 10px;
            grid-template-columns: 1fr 1.35fr;
            margin-top: 10px;
          }
          table {
            border-collapse: collapse;
            width: 100%;
          }
          th, td {
            border-bottom: 1px solid #dde4d4;
            padding: 6px 4px;
            text-align: left;
          }
          th {
            color: #687469;
            font-size: 9px;
            text-transform: uppercase;
          }
          .grid {
            display: grid;
            gap: 6px;
            grid-template-columns: repeat(3, 1fr);
          }
          .thumb {
            border: 1px solid #dde4d4;
            border-radius: 6px;
            overflow: hidden;
          }
          .thumb img {
            display: block;
            height: 72px;
            object-fit: cover;
            width: 100%;
          }
          .thumb div {
            font-size: 9px;
            font-weight: 700;
            padding: 4px;
          }
        </style>
      </head>
      <body>
        <header>
          <div>
            <h1>${escapeHtml(load.name)}</h1>
            <div class="muted">${formatDate(load.created_at)} | ${pallets.length} paletes</div>
          </div>
          <div class="total">
            Total
            <strong>${load.total_count}</strong>
            cabeças
          </div>
        </header>
        ${load.note ? `<p class="note">${escapeHtml(load.note)}</p>` : ''}
        <main class="layout">
          <table>
            <thead>
              <tr>
                <th>Palete</th>
                <th>IA</th>
                <th>Manual</th>
                <th>Final</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <section class="grid">${thumbnails}</section>
        </main>
      </body>
    </html>
  `;
}

export async function shareLoadPdf(load: Load, pallets: Pallet[]) {
  const html = buildPdfHtml(load, pallets);
  const { uri } = await Print.printToFileAsync({ html });
  const canShare = await Sharing.isAvailableAsync();

  if (!canShare) {
    throw new Error('Compartilhamento nao esta disponivel neste aparelho.');
  }

  await Sharing.shareAsync(uri, {
    dialogTitle: `Exportar ${load.name}`,
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
  });
}
