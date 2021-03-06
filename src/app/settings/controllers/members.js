angular.module('proton.settings')
.controller('MembersController', (
    $controller,
    $rootScope,
    $scope,
    $state,
    $stateParams,
    $timeout,
    Address,
    activateOrganizationModal,
    authentication,
    confirmModal,
    CONSTANTS,
    domains,
    eventManager,
    generateOrganizationModal,
    gettextCatalog,
    loginPasswordModal,
    Member,
    memberModal,
    members,
    networkActivityTracker,
    notify,
    organization,
    Organization,
    organizationKeys,
    passwords,
    pmcw
) => {

    $controller('AddressesController', { $scope, authentication, domains, members, organization, organizationKeys, pmcw });

    const MASTER = 2;
    const SUB = 1;

    function passwordModal(submit) {
        loginPasswordModal.activate({
            params: {
                submit,
                cancel: () => {
                    loginPasswordModal.deactivate();
                },
                hasTwoFactor: authentication.user.TwoFactor
            }
        });
    }

    $scope.roles = [
        { label: gettextCatalog.getString('Admin', null), value: MASTER },
        { label: gettextCatalog.getString('Member', null), value: SUB }
    ];

    $scope.initialization = () => {

        $scope.newRecoveryPassword = '';
        $scope.confirmRecoveryPassword = '';
        switch ($stateParams.action) {
            case 'new':
                $scope.addMember();
                break;
            case 'edit':
                $scope.editMember(_.findWhere($scope.members, { ID: $stateParams.id }));
                break;
            default:
                break;
        }
    };

    /**
     * We check if domains are verified
     * @return {Boolean}
     */
    $scope.checkDomains = () => {
        let verified = false;

        if (angular.isArray($scope.domains)) {
            _.each($scope.domains, (domain) => {
                if (domain.State === 1) {
                    verified = true;
                }
            });
        }

        return verified;
    };

    /**
     * Initialize select value with role user
     */
    $scope.initRole = (member) => {
        const role = _.findWhere($scope.roles, { value: member.Role });

        if (angular.isDefined(role)) {
            member.selectRole = role;
        }
    };

    /**
     * Inform the back-end to change member role
     * @param {Object} member
     */
    $scope.changeRole = (member) => {
        const payload = { Role: member.selectRole.value };

        let message;
        if (member.selectRole.value === MASTER) {
            message = gettextCatalog.getString('You must provide this member with the backup organization key password for full activation of administrator privileges.', null, 'Info');
        } else {
            message = gettextCatalog.getString('By demoting this member you agree to assume any outstanding organization-related obligations the member may have.', null, 'Info');
        }

        const params = {
            title: gettextCatalog.getString('Change Role', null, 'Error'),
            message,
            confirm() {
                networkActivityTracker.track(
                    Member.role(member.ID, payload).then(({ data }) => { // TODO check request
                        if (data && data.Code === 1000) {
                            notify({ message: gettextCatalog.getString('Role updated', null), classes: 'notification-success' });

                            member.Role = payload.Role;

                            confirmModal.deactivate();
                        } else if (data && data.Error) {
                            notify({ message: data.Error, classes: 'notification-danger' });
                        } else {
                            notify({ message: gettextCatalog.getString('Error updating role', null, 'Error'), classes: 'notification-danger' });
                        }
                    }, () => {
                        notify({ message: gettextCatalog.getString('Error updating role', null, 'Error'), classes: 'notification-danger' });
                    })
                );
            },
            cancel() {
                confirmModal.deactivate();
            }
        };

        confirmModal.activate({ params });
    };

    /**
     * Save the organization name
     */
    $scope.saveOrganizationName = () => {
        Organization.update({ DisplayName: $scope.organization.DisplayName })
        .then((result) => {
            if (result.data && result.data.Code === 1000) {
                notify({ message: gettextCatalog.getString('Organization updated', null), classes: 'notification-success' });
            } else if (result.data && result.data.Error) {
                notify({ message: result.data.Error, classes: 'notification-danger' });

            } else {
                notify({ message: gettextCatalog.getString('Error updating organization name', null, 'Error'), classes: 'notification-danger' });
            }
        }, () => {
            notify({ message: gettextCatalog.getString('Error updating organization name', null, 'Error'), classes: 'notification-danger' });
        });
    };

    /**
     * Set organization key recovery password
     */
    $scope.saveRecoveryPassword = (form) => {
        const newPassword = $scope.newRecoveryPassword;

        function submit(currentPassword, twoFactorCode) {
            loginPasswordModal.deactivate();

            const creds = {
                Password: currentPassword,
                TwoFactorCode: twoFactorCode
            };

            const keySalt = passwords.generateKeySalt();

            passwords.computeKeyPassword(newPassword, keySalt)
            .then((keyPassword) => pmcw.encryptPrivateKey($scope.organizationKey, keyPassword))
            .then((PrivateKey) => Organization.updateBackupKeys({ PrivateKey, KeySalt: keySalt }, creds))
            .then((result) => {
                if (result.data && result.data.Code === 1000) {
                    return result.data;
                } else if (result.data && result.data.Error) {
                    return Promise.reject({ message: result.data.Error });
                }
                return Promise.reject({ message: gettextCatalog.getString('Error updating organization key recovery password', null, 'Error') });
            }, () => {
                return Promise.reject({ message: gettextCatalog.getString('Error updating organization key recovery password', null, 'Error') });
            })
            .then(() => {
                // Cleanup
                $scope.newRecoveryPassword = '';
                $scope.confirmRecoveryPassword = '';
                form.$setUntouched();
                form.$setPristine();
                notify({ message: gettextCatalog.getString('Organization key recovery password updated', null), classes: 'notification-success' });
            })
            .catch((error) => {
                notify({ message: error.message, classes: 'notification-danger' });
            });
        }

        passwordModal(submit);
    };

    /**
     * Switch a specific member to private
     * @param {Object} member
     */
    $scope.makePrivate = (member) => {
        const title = gettextCatalog.getString('Privatize Member', null);
        const message = gettextCatalog.getString("Organization administrators will no longer be able to log in and control the member's account after privatization. This change is PERMANENT.", null);
        const success = gettextCatalog.getString('Status Updated', null);

        confirmModal.activate({
            params: {
                title,
                message,
                confirm() {
                    networkActivityTracker.track(
                        Member.privatize(member.ID)
                        .then((result) => {
                            if (result.data && result.data.Code === 1000) {
                                member.Private = 1;
                                notify({ message: success, classes: 'notification-success' });
                                confirmModal.deactivate();
                            } else if (result.data && result.data.Error) {
                                notify({ message: result.data.Error, classes: 'notification-danger' });
                            }
                        })
                    );
                },
                cancel() {
                    confirmModal.deactivate();
                }
            }
        });
    };

    /**
     * Allow the current user to access to the mailbox of a specific member
     * @param {Object} member
     */
    $scope.login = (member) => {

        if ($scope.keyStatus > 0 && CONSTANTS.KEY_PHASE > 3) {
            notify({ message: gettextCatalog.getString('Administrator privileges must be activated', null, 'Error'), classes: 'notification-danger' });
            $state.go('secured.members');
            return;
        }

        function submit(currentPassword, twoFactorCode) {

            loginPasswordModal.deactivate();

            const mailboxPassword = authentication.getPassword();

            const arr = window.location.href.split('/');
            const domain = arr[0] + '//' + arr[2];
            const tab = $state.href('login.sub', { sub: true }, { absolute: true });

            let ready = false;
            const receive = (event) => {
                if (event.origin !== domain) { return; }
                if (event.data === 'ready') {
                    ready = true;
                    window.removeEventListener('message', receive);
                }
            };

            // Listen message from the future child
            window.addEventListener('message', receive, false);

            // Open new tab
            const child = window.open(tab, '_blank');

            networkActivityTracker.track(
                Member.authenticate(member.ID, { Password: currentPassword, TwoFactorCode: twoFactorCode })
                .then((result) => {
                    const sessionToken = result.data.SessionToken;

                    const cb = () => {
                        if (ready) {
                            // Send the session token and the organization owner’s mailbox password to the target URI
                            child.postMessage({ SessionToken: sessionToken, MailboxPassword: mailboxPassword }, domain);
                        } else {
                            $timeout(cb, 500, false);
                        }
                    };

                    cb();
                },
                (error) => {
                    child.close();
                    notify({ message: error.error_description, classes: 'notification-danger' });
                })
            )
            .catch(() => {
                // Nothing
            });
        }

        passwordModal(submit);
    };

    /**
     * Open a modal to create a new member
     */
    $scope.addMember = () => {
        if (!$scope.canAddMember()) {
            return;
        }

        $scope.editMember();
    };

    /**
     * Display a modal to edit a member
     * @param {Object} member
     */
    $scope.editMember = (member) => {
        memberModal.activate({
            params: {
                member,
                organization: $scope.organization,
                organizationKey: $scope.organizationKey,
                domains: $scope.domains,
                submit(member) {
                    const index = _.findIndex($scope.members, { ID: member.ID });

                    if (index === -1) {
                        $scope.members.push(member);
                        $scope.organization.UsedMembers++;
                        $scope.organization.UsedAddresses++;
                    } else {
                        _.extend($scope.members[index], member);
                    }

                    memberModal.deactivate();
                },
                cancel() {
                    memberModal.deactivate();
                }
            }
        });
    };

    /**
     * Remove member
     * @param {Object} member
     */
    $scope.removeMember = (member) => {
        const title = gettextCatalog.getString('Remove member', null, 'Title');
        const message = gettextCatalog.getString('Are you sure you want to remove this member?', null, 'Info');
        const index = $scope.members.indexOf(member);

        confirmModal.activate({
            params: {
                title,
                message,
                confirm() {
                    networkActivityTracker.track(Member.delete(member.ID).then((result) => {
                        if (angular.isDefined(result.data) && result.data.Code === 1000) {

                            // Local changes
                            $scope.members.splice(index, 1); // Remove member in the members list
                            $scope.organization.UsedMembers--;
                            $scope.organization.UsedAddresses -= member.Addresses.filter((address) => address.Type !== 0).length;

                            // Event loop
                            eventManager.call();

                            confirmModal.deactivate(); // Close the modal
                            notify({ message: gettextCatalog.getString('Member removed', null), classes: 'notification-success' }); // Display notification
                        } else if (angular.isDefined(result.data) && angular.isDefined(result.data.Error)) {
                            notify({ message: result.data.Error, classes: 'notification-danger' });
                        } else {
                            notify({ message: gettextCatalog.getString('Error during deletion', null, 'Error'), classes: 'notification-danger' });
                        }
                    }, () => {
                        notify({ message: gettextCatalog.getString('Error during deletion', null, 'Error'), classes: 'notification-danger' });
                    }));
                },
                cancel() {
                    confirmModal.deactivate();
                }
            }
        });
    };

    // Call initialization
    $scope.initialization();
});
