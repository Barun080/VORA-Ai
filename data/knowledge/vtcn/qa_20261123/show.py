import csv,sys
f=sys.argv[1] if len(sys.argv)>1 else 'qa_run_report.csv'
for r in csv.DictReader(open(f,encoding='utf-8-sig')):
    flag = '' if (r['ผ่าน_ตอบได้'] in ('True','') and r['ผ่าน_คำสำคัญ'] in ('True','')) else 'XX'
    print(f"{flag:2}{r['qid']:6}{r['สถานะข้อมูล'][:4]:5}{r['intent'][:13]:14}{r['conf']:5} {r['source'][:9]:10}{r['answered'][:1]} {r['aspect'][:6]:7}| {r['คำถาม'][:30]:31}| {r['text'][:80]}")
