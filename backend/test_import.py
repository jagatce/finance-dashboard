"""
Test harness for cashflow CSV parser.
Run: .venv/bin/python3 test_import.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from app.services.cashflow_import import parse_transactions

TEST_FILES = [
    ("JP Chase2511_Activity20260305_20260404_20260413.CSV",        "chase"),
    ("JP Chase Amazon 2569_Activity20260228_20260327_20260413.CSV", "chase"),
    ("RK Chase3418_Activity20260310_20260409_20260413.CSV",         "chase"),
    ("JP Amex Blue activity (2).csv",                              "amex"),
    ("JP Amex Delta activity (1).csv",                             "amex"),
    ("RK Amex Blue activity (2).csv",                              "amex"),
    ("RK Amex delta activity (1).csv",                             "amex"),
]

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_data", "spending")

def run():
    passed = 0
    failed = 0

    for filename, expected_bank in TEST_FILES:
        path = os.path.join(DATA_DIR, filename)

        if not os.path.exists(path):
            print(f"  SKIP  {filename}")
            print(f"        looked in: {path}")
            continue

        with open(path, "rb") as f:
            content = f.read()

        result = parse_transactions(filename, content)

        if result["error"]:
            print(f"  FAIL  {filename}")
            print(f"        error: {result['error']}")
            failed += 1
            continue

        bank       = result["bank"]
        txns       = result["transactions"]
        bank_ok    = bank == expected_bank
        amounts_ok = all(t["amount"] > 0 for t in txns)
        dates_ok   = all(len(t["transaction_date"]) == 10 for t in txns)
        status     = "PASS" if (bank_ok and amounts_ok and dates_ok) else "FAIL"

        if status == "PASS": passed += 1
        else: failed += 1

        print(f"  {status}  {filename}")
        print(f"        bank={bank} (expected={expected_bank}) {'✓' if bank_ok else '✗'}")
        print(f"        transactions={len(txns)}")
        print(f"        all amounts positive : {'✓' if amounts_ok else '✗'}")
        print(f"        all dates YYYY-MM-DD : {'✓' if dates_ok else '✗'}")
        for t in txns[:3]:
            print(f"          {t['transaction_date']}  {t['description'][:40]:<40}  ${t['amount']:.2f}  {t.get('category','')}")
        print()

    print(f"Results: {passed} passed, {failed} failed")

if __name__ == "__main__":
    run()
