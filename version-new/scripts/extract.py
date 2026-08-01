import os
from pypdf import PdfReader

reader = PdfReader("assets/contract_template.pdf")

def visitor_body(text, cm, tm, fontDict, fontSize):
    # tm is the text matrix, which contains coordinates in tm[4] (x) and tm[5] (y)
    if text.strip():
        print(f"Text: {text.strip():<40} | X: {tm[4]:.2f} | Y: {tm[5]:.2f} | Font Size: {fontSize:.2f}")

print("=== PAGE 1 (Index 0) ===")
reader.pages[0].extract_text(visitor_text=visitor_body)

print("\n=== PAGE 2 (Index 1) ===")
reader.pages[1].extract_text(visitor_text=visitor_body)
