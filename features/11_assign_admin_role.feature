Feature: Create a new user in testrealm realm
  As a Tide Cloak admin user
  I want to create a user in realm

  
  Scenario: Admin creates a new user successfully
    Given the admin in the tide admin console selects realm <realm_name>
    When the admin approves, number of approvals <no_approval> for user <username> and assigns admin role and approves
    Then the admin goes back to user page selects user <username> and verifies ACTIVE status beside the role in role mapping tab


    Examples:

      | realm_name | username   | no_approval |
      | testrealm  | adminuser1 | 0           |
      | testrealm  | adminuser2 | 1           |
      | testrealm  | adminuser3 | 1           |
      | testrealm  | adminuser4 | 2           |