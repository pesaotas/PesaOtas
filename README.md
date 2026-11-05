# PesaFlow v1.0

A free, local-first personal budgeting web app.

## Included in the starter budget

- Opening balance: KSh 25,000
- Next payday: 1 December 2026
- Food: KSh 5,000
- Work transport: KSh 3,300
- Graduation extras: KSh 1,500
- Shoes: KSh 3,500
- Entertainment / dates: KSh 2,000
- Emergency savings: KSh 4,000
- December jacket fund: KSh 2,000
- Miscellaneous: KSh 1,000
- Wi-Fi: KSh 1,500
- Electricity: KSh 1,000

Total allocations: KSh 24,800. Unallocated: KSh 200.

Rent is excluded because it was already paid. The KSh 10,000 gown and return-transport payment is already reflected in the KSh 25,000 opening balance; do not enter it again.

## Run locally on Windows

### Option 1: easiest
1. Extract the ZIP file.
2. Open the `PesaFlow_v1` folder.
3. Double-click `index.html`.

The core budgeting features work when opened directly. Some install/offline PWA features require a local web server.

### Option 2: run using Python
Open Command Prompt in this folder and run:

```bat
py -m http.server 8000
```

Then open:

`http://localhost:8000`

To stop the server, return to Command Prompt and press `Ctrl + C`.

If `py` is not recognised, try:

```bat
python -m http.server 8000
```

## Privacy and backup

- Financial data is stored in this browser's LocalStorage.
- No bank, M-Pesa or cloud account is connected.
- Use Settings & backup → Download backup regularly.
- Restore a JSON backup from the same screen.
- Anyone with access to your unlocked browser profile may be able to access this app and its local data.

## Notes

This is a first working prototype, not financial advice or a bank application. Review the budget categories and payday in the app before relying on the calculations. No transaction is imported automatically.
