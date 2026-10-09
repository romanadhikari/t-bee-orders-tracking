import fitz
src='attached_assets/billlll_1791556638355.pdf'
doc=fitz.open(src)
for i,page in enumerate(doc):
    pix=page.get_pixmap(matrix=fitz.Matrix(1.8,1.8), alpha=False)
    pix.save(f'.agents/outputs/invoice-page-{i+1}.png')
    print(f'page {i+1}: {page.rect.width:.0f}x{page.rect.height:.0f}pt, text chars={len(page.get_text())}, images={len(page.get_images(full=True))}')
