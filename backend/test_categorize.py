"""
Test Claude auto-categorization against real transaction descriptions.
Run: .venv/bin/python3 test_categorize.py
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))

from app.core import config  # loads .env
from app.services.cashflow_import import parse_transactions
import anthropic

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_data", "spending")

TEST_FILES = [
    "JP Chase2511_Activity20260305_20260404_20260413.CSV",
    "JP Amex Blue activity (2).csv",
]

CATEGORIES = [
    "Groceries", "Dining", "Transport", "Gas", "Shopping",
    "Entertainment", "Subscriptions", "Health", "Travel",
    "Utilities", "Insurance", "Rent/Mortgage", "Education",
    "Personal Care", "Gifts", "Other"
]

def categorize(descriptions):
    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
    prompt = f"""You are categorizing personal finance transactions.
Given these transaction descriptions, suggest a category and subcategory for each.
Also flag if it looks like a recurring subscription (is_recurring: true/false).

Available categories: {', '.join(CATEGORIES)}

Transactions:
{chr(10).join(f'{i+1}. {d}' for i, d in enumerate(descriptions))}

Respond ONLY with a JSON array, one object per transaction, in order:
[{{"description": "...", "category": "...", "subcategory": "...", "is_recurring": false}}, ...]
No markdown, no explanation, just the JSON array."""

    message = client.messages.create(
        model="claude-opus-4-5",
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}]
    )
    return json.loads(message.content[0].text.strip())

def run():
    all_txns = []
    for filename in TEST_FILES:
        path = os.path.join(DATA_DIR, filename)
        with open(path, "rb") as f:
            content = f.read()
        result = parse_transactions(filename, content)
        all_txns.extend(result["transactions"])

    descriptions = [t["description"] for t in all_txns]
    print(f"Categorizing {len(descriptions)} transactions...\n")

    suggestions = categorize(descriptions)

    print(f"{'Description':<45} {'Bank Cat':<15} {'Claude Cat':<15} {'Subcategory':<20} Recurring")
    print("-" * 110)
    for txn, sug in zip(all_txns, suggestions):
        recurring = "✓" if sug.get("is_recurring") else ""
        print(f"{txn['description'][:44]:<45} {str(txn.get('category',''))[:14]:<15} {sug['category'][:14]:<15} {str(sug.get('subcategory',''))[:19]:<20} {recurring}")

    print(f"\nDone. {len(suggestions)} suggestions returned.")

if __name__ == "__main__":
    run()
