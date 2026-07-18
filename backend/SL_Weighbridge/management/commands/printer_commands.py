def get_printer_command(printer_config, transaction):
    """Return the appropriate command based on the printer type."""
    if printer_config.printer_type == 'Zebra':
        command = "^XA\n"
        command += "^FO50,50^GB600,0,3^FS\n"  # Add a horizontal line for separation
        command += "^FO50,50^A0N,36,36^FB600,,C^FD METRIX WEIGHBRIDGE SERVICES ^FS\n"  # Bold and centered
        command += "^FO50,100^A0N,30,30^FB600,,C^FD Athi River, Machakos ^FS\n"
        command += "^FO50,150^A0N,30,30^FB600,,C^FD Email: info@metrixws.co.ke ^FS\n"
        command += "^FO50,200^A0N,30,30^FB600,,C^FD Tel: 0715 488 903 ^FS\n"
        command += "^FO50,250^A0N,30,30^FB600,,C^FD Website: www.metrixws.co.ke ^FS\n"
        command += "^FO50,350^A0N,30,30^FD Customer Name: {transaction.customer.name} ^FS\n"
        command += "^FO50,400^A0N,30,30^FD Weighing Type: {transaction.weight_type} ^FS\n"
        command += "^FO50,450^A0N,30,30^FD Date: {transaction.weight_date} ^FS\n"
        command += "^FO50,500^A0N,30,30^FD Vehicle No: {transaction.vehicle.number_plate} ^FS\n"
        command += "^FO50,550^A0N,30,30^FD Item Name: {transaction.item.name} ^FS\n"
        command += "^FO50,600^A0N,30,30^FD Gross Weight (kg): {transaction.gross_weight} ^FS\n"
        command += "^FO50,650^A0N,30,30^FD Tare Weight (kg): {transaction.tare_weight} ^FS\n"
        command += "^FO50,700^A0N,30,30^FD Net Weight (kg): {transaction.net_weight} ^FS\n"
        command += "^FO50,750^A0N,30,30^FD Charges (KES): {transaction.vehicle_type.charge} ^FS\n"
        qr_data = f"Transaction ID: {transaction.id}\nNet Weight: {transaction.net_weight}"
        command += f"^FO50,850^BQN,2,10^FDQA,{qr_data}^FS\n"
        command += "^LL600\n"
        command += "^XZ\n"
    elif printer_config.printer_type == 'Epson':
        command = "\x1B@\n"
        command += "\x1B|cA\n"  # Center alignment
        command += "\x1B|bA\n"  # Bold mode
        command += "METRIX WEIGHBRIDGE SERVICES\n"
        command += "Athi River, Machakos\n"
        command += "Email: info@metrixws.co.ke\n"
        command += "Tel: 0715 488 903\n"
        command += "Website: www.metrixws.co.ke\n\n"
        command += "\x1B|bA0\n"  # Turn off bold mode
        command += f"Customer Name: {transaction.customer.name}\n"
        command += f"Weighing Type: {transaction.weight_type}\n"
        command += f"Date: {transaction.weight_date}\n\n"
        command += f"Vehicle No: {transaction.vehicle.number_plate}\n"
        command += f"Item Name: {transaction.item.name}\n"
        command += f"Gross Weight (kg): {transaction.gross_weight}\n"
        command += f"Tare Weight (kg): {transaction.tare_weight}\n"
        command += f"Net Weight (kg): {transaction.net_weight}\n"
        command += f"Charges (KES): {transaction.vehicle_type.charge}\n"
        command += "\x1D\x56\x41"  # Full paper cut command
    else:
        command = None

    return command
