from django import forms

from .models import Company, Branch, Transaction, Vehicle


class CompanyForm(forms.ModelForm):
    class Meta:
        model = Company
        fields = ['name', 'address', 'email', 'phone', 'logo']

class BranchForm(forms.ModelForm):
    class Meta:
        model = Branch
        fields = ['company', 'name', 'address', 'email', 'phone']

#TransactionForm
class TransactionForm(forms.ModelForm):
    class Meta:
        model = Transaction
        fields = [
            'customer', 'vehicle', 'operator', 'item', 'vehicle_type',
            'gross_weight', 'tare_weight', 'net_weight', 'gross_weight_date',
            'tare_weight_date', 'weight_type', 'manual_weight_capture'
        ]
        widgets = {
            'customer': forms.Select(),
            'vehicle': forms.Select(),
            'item': forms.Select(),
            'vehicle_type': forms.Select(),
            'weight_type': forms.Select(choices=[('First Weight', 'First Weight'), ('Second Weight', 'Second Weight')]),
            'gross_weight_date': forms.DateTimeInput(attrs={'type': 'datetime-local'}),
            'tare_weight_date': forms.DateTimeInput(attrs={'type': 'datetime-local'}),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if 'customer' in self.data:
            try:
                customer_id = int(self.data.get('customer'))
                self.fields['vehicle'].queryset = Vehicle.objects.filter(customer_id=customer_id)
            except (ValueError, TypeError):
                self.fields['vehicle'].queryset = Vehicle.objects.none()
        elif self.instance.pk:
            self.fields['vehicle'].queryset = self.instance.customer.vehicles_set.order_by('number_plate')

    def clean(self):
        cleaned_data = super().clean()
        gross_weight = cleaned_data.get("gross_weight")
        tare_weight = cleaned_data.get("tare_weight")
        manual_weight_capture = cleaned_data.get("manual_weight_capture")

        if not manual_weight_capture:
            if gross_weight is not None and tare_weight is not None:
                cleaned_data['net_weight'] = gross_weight - tare_weight
            else:
                self.add_error('gross_weight', 'Gross weight and Tare weight must be provided.')
        return cleaned_data
        



class ApprovalForm(forms.ModelForm):
    class Meta:
        model = Transaction  
        fields = ['approval_status']

    def __init__(self, *args, **kwargs):
        from .models import Transaction  
        super().__init__(*args, **kwargs)


#InvoiceForm to pre-populate unpaid transactions

from django import forms
from .models import Invoice, Transaction

class InvoiceForm(forms.ModelForm):
    class Meta:
        model = Invoice
        fields = ['customer']  # transactions will be auto-populated

    def clean(self):
        cleaned_data = super().clean()
        customer = cleaned_data.get('customer')

        if customer:
            unpaid_txns = Transaction.objects.filter(customer=customer, payment_status='Pending')
            if not unpaid_txns.exists():
                raise forms.ValidationError(
                    f"No unpaid transactions found for customer '{customer}'. Please check."
                )

        return cleaned_data




# RECEIVE PAYMENT

from django import forms

class ReceivePaymentForm(forms.Form):
    _selected_action = forms.CharField(widget=forms.MultipleHiddenInput)
    payment_method = forms.ChoiceField(choices=[
        ('Cash', 'Cash'),
        ('Mpesa', 'Mpesa'),
        ('Bank Deposit', 'Bank Deposit'),
        ('Debt', 'Debt'),
    ])



