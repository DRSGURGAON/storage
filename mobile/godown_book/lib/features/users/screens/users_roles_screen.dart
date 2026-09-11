import 'package:flutter/material.dart';

import '../../../core/permissions/permission_service.dart';
import '../models/role_model.dart';
import '../models/user_model.dart';
import '../repositories/role_repository.dart';
import '../repositories/user_repository.dart';

/// Users & Roles management - deliberately minimal per the task's own
/// "do not overbuild the UI" instruction: view users, assign a role,
/// activate/deactivate, view a role's permissions. Custom-role creation
/// is supported (the architecture allows it - see
/// RoleRepository.createCustomRole) via a simple name-entry dialog, not
/// a full permission-matrix editor.
class UsersRolesScreen extends StatefulWidget {
  const UsersRolesScreen({super.key});

  @override
  State<UsersRolesScreen> createState() => _UsersRolesScreenState();
}

class _UsersRolesScreenState extends State<UsersRolesScreen> {
  List<UserModel> _users = [];
  List<RoleModel> _roles = [];
  bool _loading = true;
  bool _isUnmanagedAdmin = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    final users = await UserRepository.instance.getAll();
    final roles = await RoleRepository.instance.getAll();
    final isUnmanaged = await PermissionService.isUnmanagedAdmin();

    if (!mounted) return;

    setState(() {
      _users = users;
      _roles = roles;
      _isUnmanagedAdmin = isUnmanaged;
      _loading = false;
    });
  }

  String _roleName(String roleId) {
    for (final role in _roles) {
      if (role.id == roleId) return role.name;
    }
    return 'Unknown role';
  }

  Future<void> _toggleActive(UserModel user) async {
    try {
      await UserRepository.instance.setActive(user, !user.isActive);
      if (!mounted) return;
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _assignRole(UserModel user) async {
    final selected = await showDialog<RoleModel>(
      context: context,
      builder: (dialogContext) => SimpleDialog(
        title: Text('Assign role to ${user.name}'),
        children: [
          for (final role in _roles)
            SimpleDialogOption(
              onPressed: () => Navigator.pop(dialogContext, role),
              child: Text(role.name),
            ),
        ],
      ),
    );

    if (selected == null) return;

    try {
      await UserRepository.instance.assignRole(user, selected);
      if (!mounted) return;
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _addUser() async {
    final nameController = TextEditingController();
    final mobileController = TextEditingController();
    RoleModel? selectedRole = _roles.isNotEmpty ? _roles.first : null;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Add User'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: nameController,
                decoration: const InputDecoration(labelText: 'Name'),
              ),
              TextField(
                controller: mobileController,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(labelText: 'Mobile Number'),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<RoleModel>(
                initialValue: selectedRole,
                decoration: const InputDecoration(labelText: 'Role'),
                items: [
                  for (final role in _roles)
                    DropdownMenuItem(value: role, child: Text(role.name)),
                ],
                onChanged: (value) =>
                    setDialogState(() => selectedRole = value),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Add'),
            ),
          ],
        ),
      ),
    );

    if (confirmed != true ||
        nameController.text.trim().isEmpty ||
        mobileController.text.trim().isEmpty ||
        selectedRole == null) {
      return;
    }

    try {
      await UserRepository.instance.createUser(
        name: nameController.text.trim(),
        mobileNumber: mobileController.text.trim(),
        roleId: selectedRole!.id,
      );
      if (!mounted) return;
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _addCustomRole() async {
    final controller = TextEditingController();

    final name = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('New Custom Role'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(labelText: 'Role Name'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, controller.text),
            child: const Text('Create'),
          ),
        ],
      ),
    );

    if (name == null || name.trim().isEmpty) return;

    try {
      await RoleRepository.instance.createCustomRole(
        name: name.trim(),
        sortOrder: (_roles.length + 1) * 10,
      );
      if (!mounted) return;
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _viewRolePermissions(RoleModel role) async {
    final permissions = await RoleRepository.instance.getPermissionsForRole(
      role.id,
    );

    if (!mounted) return;

    showDialog(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('${role.name} - Permissions'),
        content: SizedBox(
          width: double.maxFinite,
          child: permissions.isEmpty
              ? const Text('No permissions granted.')
              : ListView(
                  shrinkWrap: true,
                  children: [
                    for (final permission in permissions)
                      Text('• ${permission.code}'),
                  ],
                ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Users & Roles')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(12),
              children: [
                if (_isUnmanagedAdmin)
                  Card(
                    color: Theme.of(context).colorScheme.surfaceContainerHighest,
                    child: const Padding(
                      padding: EdgeInsets.all(12),
                      child: Row(
                        children: [
                          Icon(Icons.info_outline, size: 18),
                          SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'You are signed in as the default Company '
                              'Admin - no user record has been created '
                              'for your number yet. Adding users below '
                              'does not affect your own access.',
                              style: TextStyle(fontSize: 12),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),

                const SizedBox(height: 12),

                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Users', style: Theme.of(context).textTheme.titleMedium),
                    TextButton.icon(
                      onPressed: _addUser,
                      icon: const Icon(Icons.person_add_alt, size: 18),
                      label: const Text('Add User'),
                    ),
                  ],
                ),

                if (_users.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 16),
                    child: Text(
                      'No users added yet.',
                      style: TextStyle(color: Colors.grey),
                    ),
                  ),

                for (final user in _users)
                  Card(
                    child: ListTile(
                      title: Text(user.name),
                      subtitle: Text(
                        '${user.mobileNumber}  •  '
                        '${_roleName(user.roleId)}'
                        '${!user.isActive ? '  •  Inactive' : ''}',
                      ),
                      trailing: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          IconButton(
                            icon: const Icon(Icons.badge_outlined, size: 20),
                            tooltip: 'Assign Role',
                            onPressed: () => _assignRole(user),
                          ),
                          Switch(
                            value: user.isActive,
                            onChanged: (_) => _toggleActive(user),
                          ),
                        ],
                      ),
                    ),
                  ),

                const SizedBox(height: 20),

                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Roles', style: Theme.of(context).textTheme.titleMedium),
                    TextButton.icon(
                      onPressed: _addCustomRole,
                      icon: const Icon(Icons.add, size: 18),
                      label: const Text('Custom Role'),
                    ),
                  ],
                ),

                for (final role in _roles)
                  Card(
                    child: ListTile(
                      title: Text(role.name),
                      subtitle: Text(role.isSystem ? 'Built-in' : 'Custom'),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => _viewRolePermissions(role),
                    ),
                  ),
              ],
            ),
    );
  }
}
