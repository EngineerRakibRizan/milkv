import 'package:url_launcher/url_launcher.dart';

/// Bangladesh numbers: "01712-345678" → "8801712345678" for WhatsApp links.
String waNumber(String phone) {
  var d = phone.replaceAll(RegExp(r'[^0-9]'), '');
  if (d.startsWith('0')) d = '88$d';
  if (d.length == 10 && d.startsWith('1')) d = '880$d';
  return d;
}

Future<void> callPhone(String phone) => launchUrl(Uri(scheme: 'tel', path: phone.replaceAll(RegExp(r'[^0-9+]'), '')));

Future<void> openWhatsApp(String phone, {String? text}) => launchUrl(
      Uri.https('wa.me', '/${waNumber(phone)}', text == null ? null : {'text': text}),
      mode: LaunchMode.externalApplication,
    );
