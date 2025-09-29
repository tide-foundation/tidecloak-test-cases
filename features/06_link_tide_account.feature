Feature: Linking Tide Account
  As a tide Cloak user
  I want to link to tide account

  @user_setup
  Scenario: User links the tide account
    Given the admin in the tide admin console selects realm <realm_name>
    When the admin searches for user <username> and copy link to link tide account
    And the copies link and opens it in new tab and email is verified
    And user links tide account with creds <tide_username> and <tide_password>
    Then verify account updated

    Examples:

      | realm_name | username   | tide_username | tide_password |
      | testrealm  | adminuser1 | adminuser1    | adminuser1    |
      | testrealm  | adminuser2 | adminuser2    | adminuser2    |
      | testrealm  | adminuser3 | adminuser3    | adminuser3    |
      | testrealm  | adminuser4 | adminuser4    | adminuser4    |
      | testing    | testuser1  | testuser1     | testuser1     |