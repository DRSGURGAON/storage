import 'dart:io';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import '../../../shared/widgets/save_problem.dart';

import '../../storage_booking/models/storage_booking_model.dart';
import '../../storage_booking/models/storage_photo_model.dart';
import '../../storage_booking/repositories/storage_booking_repository.dart';
import '../../storage_booking/repositories/storage_photo_repository.dart';
import '../models/incident_model.dart';
import '../repositories/incident_repository.dart';

/// Writing down what went wrong, the day it went wrong. Short fields,
/// a photo button, and nothing that needs explaining.
class IncidentFormScreen extends StatefulWidget {
  /// The storage record the goods belong to, when there is one.
  final String? bookingId;

  /// An existing report being completed or corrected.
  final String? incidentId;

  const IncidentFormScreen({super.key, this.bookingId, this.incidentId});

  @override
  State<IncidentFormScreen> createState() => _IncidentFormScreenState();
}

class _IncidentFormScreenState extends State<IncidentFormScreen> {
  static final _dateFormat = DateFormat('dd MMM yyyy');

  final _goods = TextEditingController();
  final _what = TextEditingController();
  final _action = TextEditingController();
  final _loss = TextEditingController();
  final _police = TextEditingController();
  final _reportedBy = TextEditingController();
  final _place = TextEditingController();

  IncidentKind _kind = IncidentKind.damage;
  DateTime _happenedOn = DateTime.now();
  bool _customerInformed = false;
  bool _insurerInformed = false;

  StorageBookingModel? _booking;
  IncidentModel? _saved;
  List<StoragePhotoModel> _photos = const [];
  bool _loading = true;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  @override
  void dispose() {
    _goods.dispose();
    _what.dispose();
    _action.dispose();
    _loss.dispose();
    _police.dispose();
    _reportedBy.dispose();
    _place.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    IncidentModel? existing;
    if ((widget.incidentId ?? '').isNotEmpty) {
      existing = await IncidentRepository.instance.getById(widget.incidentId!);
    }

    final bookingId = existing?.bookingId.isNotEmpty == true
        ? existing!.bookingId
        : (widget.bookingId ?? '');

    StorageBookingModel? booking;
    if (bookingId.isNotEmpty) {
      booking = await StorageBookingRepository.instance.getById(bookingId);
    }

    var photos = const <StoragePhotoModel>[];
    if (existing != null) {
      photos = await StoragePhotoRepository.instance.getForIncident(existing.id);
      _goods.text = existing.goodsAffected;
      _what.text = existing.whatHappened;
      _action.text = existing.actionTaken;
      _loss.text = existing.estimatedLoss > 0
          ? existing.estimatedLoss.toStringAsFixed(0)
          : '';
      _police.text = existing.policeReference;
      _reportedBy.text = existing.reportedBy;
      _place.text = existing.place;
      _kind = existing.kind;
      _happenedOn = DateTime.tryParse(existing.happenedOn) ?? DateTime.now();
      _customerInformed = existing.customerInformed;
      _insurerInformed = existing.insurerInformed;
    }

    if (!mounted) return;
    setState(() {
      _booking = booking;
      _saved = existing;
      _photos = photos;
      _place.text = _place.text.isEmpty ? (booking?.locationName ?? '') : _place.text;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () =>
              context.canPop() ? context.pop(_saved?.id) : context.go('/incidents'),
        ),
        title: const Text('Damage / Loss Report'),
        centerTitle: true,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 110),
              children: [
                if (_booking != null) _bookingCard(_booking!),
                if (_booking != null) const SizedBox(height: 12),
                _kindCard(),
                const SizedBox(height: 12),
                _detailsCard(),
                const SizedBox(height: 12),
                _photosCard(),
                const SizedBox(height: 12),
                _informedCard(),
              ],
            ),
      bottomNavigationBar: _loading
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
                child: SizedBox(
                  height: 52,
                  child: FilledButton.icon(
                    icon: const Icon(Icons.save_outlined),
                    label: Text(_busy ? 'Please wait...' : 'Save report'),
                    onPressed: _busy ? null : _saveAndClose,
                  ),
                ),
              ),
            ),
    );
  }

  Widget _bookingCard(StorageBookingModel booking) {
    return Card(
      child: ListTile(
        leading: const CircleAvatar(child: Icon(Icons.inventory_2_outlined)),
        title: Text(booking.customerName,
            style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Text('Storage ${booking.bookingNo}'),
      ),
    );
  }

  Widget _kindCard() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('What happened?',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 4,
              children: [
                for (final kind in IncidentKind.values)
                  ChoiceChip(
                    label: Text(kind.label),
                    selected: _kind == kind,
                    onSelected: (_) => setState(() => _kind = kind),
                  ),
              ],
            ),
            const SizedBox(height: 14),
            OutlinedButton.icon(
              icon: const Icon(Icons.event_outlined, size: 18),
              label: Text('On ${_dateFormat.format(_happenedOn)}'),
              onPressed: () async {
                final picked = await showDatePicker(
                  context: context,
                  initialDate: _happenedOn,
                  firstDate: DateTime(2020),
                  lastDate: DateTime.now(),
                );
                if (picked != null) setState(() => _happenedOn = picked);
              },
            ),
          ],
        ),
      ),
    );
  }

  Widget _detailsCard() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            TextField(
              controller: _what,
              maxLines: 4,
              decoration: const InputDecoration(
                labelText: 'Write what you saw',
                hintText: 'Two or three lines is enough',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _goods,
              maxLines: 2,
              decoration: const InputDecoration(
                labelText: 'Which goods',
                hintText: 'Sofa set, 3 cartons...',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _action,
              maxLines: 2,
              decoration: const InputDecoration(
                labelText: 'What you did about it (optional)',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _loss,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                labelText: 'Rough value of the loss (optional)',
                prefixText: '₹ ',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _place,
              decoration: const InputDecoration(
                labelText: 'Where in the godown (optional)',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _photosCard() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Photos',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
            const Text('Photos taken today are what an insurer asks for.',
                style: TextStyle(fontSize: 12, color: Colors.black54)),
            const SizedBox(height: 12),
            if (_photos.isNotEmpty)
              SizedBox(
                height: 96,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: _photos.length,
                  separatorBuilder: (context, index) => const SizedBox(width: 8),
                  itemBuilder: (context, index) => _photoTile(_photos[index]),
                ),
              ),
            if (_photos.isNotEmpty) const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    icon: const Icon(Icons.photo_camera_outlined, size: 18),
                    label: const Text('Camera'),
                    onPressed: _busy ? null : () => _addPhoto(ImageSource.camera),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton.icon(
                    icon: const Icon(Icons.photo_library_outlined, size: 18),
                    label: const Text('Gallery'),
                    onPressed: _busy ? null : () => _addPhoto(ImageSource.gallery),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _photoTile(StoragePhotoModel photo) {
    return GestureDetector(
      onLongPress: () async {
        final remove = await showDialog<bool>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            title: const Text('Remove this photo?'),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(false),
                child: const Text('Keep'),
              ),
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(true),
                child: const Text('Remove'),
              ),
            ],
          ),
        );
        if (remove == true) {
          await StoragePhotoRepository.instance.delete(photo);
          await _reloadPhotos();
        }
      },
      child: ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: Image.file(File(photo.filePath),
            width: 96, height: 96, fit: BoxFit.cover,
            errorBuilder: (context, error, stack) => Container(
                  width: 96,
                  height: 96,
                  color: Colors.black12,
                  child: const Icon(Icons.broken_image_outlined),
                )),
      ),
    );
  }

  Widget _informedCard() {
    return Card(
      child: Column(
        children: [
          SwitchListTile(
            value: _customerInformed,
            title: const Text('Customer informed'),
            onChanged: (value) => setState(() => _customerInformed = value),
          ),
          const Divider(height: 1),
          SwitchListTile(
            value: _insurerInformed,
            title: const Text('Insurance company informed'),
            onChanged: (value) => setState(() => _insurerInformed = value),
          ),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
            child: Column(
              children: [
                TextField(
                  controller: _police,
                  decoration: const InputDecoration(
                    labelText: 'Police / FIR number (if any)',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: _reportedBy,
                  decoration: const InputDecoration(
                    labelText: 'Reported by',
                    hintText: 'Who noticed it',
                    border: OutlineInputBorder(),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  IncidentModel _draft() {
    final booking = _booking;
    return IncidentModel(
      id: _saved?.id ?? '',
      reportNo: _saved?.reportNo ?? '',
      reportDate: _saved?.reportDate ?? DateTime.now().toIso8601String(),
      kind: _kind,
      bookingId: booking?.id ?? '',
      bookingNo: booking?.bookingNo ?? '',
      customerId: booking?.customerId ?? '',
      customerName: booking?.customerName ?? '',
      customerPhone: booking?.customerPhone ?? '',
      happenedOn: _happenedOn.toIso8601String(),
      place: _place.text.trim(),
      goodsAffected: _goods.text.trim(),
      whatHappened: _what.text.trim(),
      actionTaken: _action.text.trim(),
      estimatedLoss: double.tryParse(_loss.text.trim()) ?? 0,
      policeReference: _police.text.trim(),
      insurerInformed: _insurerInformed,
      customerInformed: _customerInformed,
      reportedBy: _reportedBy.text.trim(),
      createdAt: _saved?.createdAt ?? '',
    );
  }

  /// Photos need something to belong to, so the report is written to
  /// the book the moment the first photo is taken.
  Future<IncidentModel?> _ensureSaved() async {
    if (_what.text.trim().isEmpty && _goods.text.trim().isEmpty) {
      _tell('Write what happened first.');
      return null;
    }

    final saved = await IncidentRepository.instance.save(_draft());
    if (mounted) setState(() => _saved = saved);
    return saved;
  }

  Future<void> _addPhoto(ImageSource source) async {
    setState(() => _busy = true);
    try {
      final incident = await _ensureSaved();
      if (incident == null) return;

      await StoragePhotoRepository.instance.addPhoto(
        bookingId: incident.bookingId,
        incidentId: incident.id,
        source: source,
      );
      await _reloadPhotos();
    } catch (error) {
      if (mounted) _tell('Could not add the photo: $error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reloadPhotos() async {
    final incident = _saved;
    if (incident == null) return;
    final photos = await StoragePhotoRepository.instance.getForIncident(incident.id);
    if (!mounted) return;
    setState(() => _photos = photos);
  }

  Future<void> _saveAndClose() async {
    setState(() => _busy = true);
    try {
      final saved = await _ensureSaved();
      if (saved == null) return;
      if (!mounted) return;
      context.pop(saved.id);
    } catch (error) {
      if (mounted) showSaveProblem(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _tell(String message) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }
}
