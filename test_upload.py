import requests
files = {'file': ('test.pdf', b'%PDF-1.4...', 'application/pdf')}
response = requests.post('http://localhost:8000/extract_pdf_text', files=files)
print(response.status_code)
print(response.text)
